'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '../lib/supabase/client'
import { safeCalculate } from '../lib/calculator'

const MAX_FILE_BYTES = 8 * 1024 * 1024
const ALLOWED_TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'html', 'css', 'js', 'jsx', 'ts', 'tsx'])
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function validateSelectedFile(file: File) {
  if (file.size > MAX_FILE_BYTES) return 'File must be 8 MB or smaller.'
  const ext = file.name.toLowerCase().split('.').pop() || ''
  if (!file.type.startsWith('image/') && !ALLOWED_TEXT_EXTENSIONS.has(ext)) return 'Unsupported file type.'
  if (file.type.startsWith('image/') && !ALLOWED_IMAGE_TYPES.has(file.type)) return 'Unsupported image type.'
  return ''
}

type Section = 'chat' | 'dashboard' | 'tools' | 'memory' | 'tasks' | 'files' | 'settings'
type Message = { id: string; role: 'user' | 'assistant'; content: string; created_at: string }
type Conversation = { id: string; title: string; updated_at: string }
type Task = { id: string; text: string; done: boolean; createdAt: number; dueDate?: string }
type ToolId = 'search' | 'calculator' | 'calendar' | 'summarize' | 'translate' | 'analyze'

const sections: Array<[Section, string, string]> = [
  ['chat', 'Chat', '⌕'],
  ['dashboard', 'Dashboard', '▦'],
  ['tools', 'Tools', '✦'],
  ['memory', 'Memory', '◈'],
  ['tasks', 'Tasks', '✓'],
  ['files', 'Files', '□'],
  ['settings', 'Settings', '⚙']
]

const tools: Array<[ToolId, string, string, string]> = [
  ['search', 'Web search', '⌕', 'Search current information on the web.'],
  ['calculator', 'Calculator', '＋', 'Calculate arithmetic locally.'],
  ['calendar', 'Calendar', '▣', 'Open your task calendar.'],
  ['summarize', 'Summarize', '≡', 'Summarize text or a selected file.'],
  ['translate', 'Translate', '文', 'Translate text to another language.'],
  ['analyze', 'Analyze file', '⌁', 'Analyze a text or image file.']
]

function dateKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatDay(value: string) {
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function readText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Could not read the file.'))
    reader.readAsText(file)
  })
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Could not read the image.'))
    reader.readAsDataURL(file)
  })
}

export default function JarvisApp() {
  const supabase = useMemo(() => createClient(), [])
  const [user, setUser] = useState<any>(null)
  const [startupError, setStartupError] = useState('')
  const [section, setSection] = useState<Section>('chat')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [memoryOn, setMemoryOn] = useState(true)
  const [voiceOn, setVoiceOn] = useState(false)
  const [listening, setListening] = useState(false)
  const [memories, setMemories] = useState<string[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [settings, setSettings] = useState({ displayName: '', assistantName: 'JARVIS' })
  const [tool, setTool] = useState<ToolId | null>(null)
  const [toolInput, setToolInput] = useState('')
  const [toolOutput, setToolOutput] = useState('')
  const [toolLoading, setToolLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [calendarMonth, setCalendarMonth] = useState(new Date())
  const [taskInput, setTaskInput] = useState('')
  const [taskDueDate, setTaskDueDate] = useState('')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const recognitionRef = useRef<any>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('jarvis_tasks') || '[]')
      if (Array.isArray(saved)) setTasks(saved)
      const savedTheme = localStorage.getItem('jarvis_theme')
      if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme)
    } catch {}
  }, [])

  useEffect(() => {
    localStorage.setItem('jarvis_tasks', JSON.stringify(tasks))
  }, [tasks])

  useEffect(() => {
    localStorage.setItem('jarvis_theme', theme)
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    composerRef.current?.focus()
  }, [conversation?.id])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        let currentUser = session?.user ?? null
        if (!currentUser) {
          const result = await supabase.auth.signInAnonymously()
          if (result.error) throw result.error
          currentUser = result.data.user
        }
        if (!currentUser || cancelled) throw new Error('Could not create a JARVIS session.')
        setUser(currentUser)

        const [{ data: settingsRow }, { data: memoryRows }] = await Promise.all([
          supabase.from('user_settings').select('voice_enabled,display_name,assistant_name').eq('user_id', currentUser.id).maybeSingle(),
          supabase.from('memories').select('memory').eq('user_id', currentUser.id).order('updated_at', { ascending: false }).limit(50)
        ])

        if (settingsRow) {
          setVoiceOn(!!settingsRow.voice_enabled)
          setSettings({
            displayName: settingsRow.display_name || '',
            assistantName: settingsRow.assistant_name || 'JARVIS'
          })
        }
        setMemories((memoryRows || []).map((row: any) => String(row.memory)))

        const { data: rows, error } = await supabase
          .from('conversations')
          .select('id,title,updated_at')
          .eq('user_id', currentUser.id)
          .order('updated_at', { ascending: false })

        if (error) throw error
        const list = (rows || []) as Conversation[]
        setConversations(list)

        if (list.length) {
          await selectConversation(list[0])
        } else {
          await createConversation(currentUser.id)
        }
      } catch (error: any) {
        if (!cancelled) setStartupError(error?.message || 'Could not start JARVIS.')
      }
    })()
    return () => { cancelled = true }
  }, [supabase])

  async function createConversation(uid = user?.id) {
    if (!uid) return
    const { data, error } = await supabase
      .from('conversations')
      .insert({ user_id: uid, title: 'New chat' })
      .select('id,title,updated_at')
      .single()
    if (error || !data) return
    setConversations(previous => [data as Conversation, ...previous.filter(item => item.id !== data.id)])
    setConversation(data as Conversation)
    setMessages([])
    setSection('chat')
    setSidebarOpen(false)
  }

  async function selectConversation(item: Conversation) {
    setConversation(item)
    const { data } = await supabase
      .from('messages')
      .select('id,role,content,created_at')
      .eq('conversation_id', item.id)
      .order('created_at', { ascending: true })
    setMessages((data || []).filter((message: any) => message.role === 'user' || message.role === 'assistant') as Message[])
    setSection('chat')
    setSidebarOpen(false)
  }

  function navigate(next: Section) {
    setSection(next)
    setSidebarOpen(false)
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim()
    if (!text || !conversation || loading) return

    const active = conversation
    const isFirstMessage = messages.length === 0
    setInput('')
    setLoading(true)
    setMessages(previous => [...previous, {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      created_at: new Date().toISOString()
    }])

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Your JARVIS session expired. Refresh the page and try again.')

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Jarvis-Client': 'web',
          Authorization: 'Bearer ' + session.access_token
        },
        body: JSON.stringify({ conversationId: active.id, message: text, memoryOn })
      })
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || 'Request failed.')

      const answer = String(data.answer || 'I could not generate a response.')
      setMessages(previous => [...previous, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: answer,
        created_at: new Date().toISOString()
      }])

      if (isFirstMessage && user) {
        const title = text.length > 52 ? text.slice(0, 52).trim() + '…' : text
        await supabase.from('conversations').update({
          title,
          updated_at: new Date().toISOString()
        }).eq('id', active.id).eq('user_id', user.id)
        setConversations(previous => previous.map(item => item.id === active.id ? { ...item, title } : item))
      } else {
        setConversations(previous => previous.map(item => item.id === active.id ? { ...item, updated_at: new Date().toISOString() } : item))
      }

      if (voiceOn && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(answer))
      }
    } catch (error: any) {
      setMessages(previous => [...previous, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'I hit an error: ' + (error?.message || 'Something went wrong.'),
        created_at: new Date().toISOString()
      }])
    } finally {
      setLoading(false)
    }
  }

  function startVoice() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setInput(previous => previous || 'Voice input is not supported in this browser.')
      return
    }
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = 'en-CA'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript || ''
      setInput(transcript)
      setTimeout(() => composerRef.current?.focus(), 0)
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)
    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }

  async function toggleVoice() {
    const next = !voiceOn
    setVoiceOn(next)
    if (user) {
      await supabase.from('user_settings').upsert({
        user_id: user.id,
        voice_enabled: next,
        updated_at: new Date().toISOString()
      })
    }
  }

  async function saveSettings() {
    if (!user) return
    const name = settings.assistantName.trim() || 'JARVIS'
    setSettings(previous => ({ ...previous, assistantName: name }))
    await supabase.from('user_settings').upsert({
      user_id: user.id,
      display_name: settings.displayName.trim(),
      assistant_name: name,
      voice_enabled: voiceOn,
      updated_at: new Date().toISOString()
    })
  }

  function addTask() {
    const text = taskInput.trim()
    if (!text) return
    setTasks(previous => [{
      id: crypto.randomUUID(),
      text,
      done: false,
      createdAt: Date.now(),
      dueDate: taskDueDate || undefined
    }, ...previous])
    setTaskInput('')
    setTaskDueDate('')
  }

  function runCalculator(expression: string) {
    try {
      return safeCalculate(expression)
    } catch (error: any) {
      return error?.message || 'Invalid expression.'
    }
  }

  async function runTool() {
    if (!tool) return
    if (tool === 'calculator') {
      setToolOutput(runCalculator(toolInput))
      return
    }
    if (tool === 'calendar') {
      setTool(null)
      navigate('tasks')
      return
    }
    if (tool === 'analyze' && !selectedFile) {
      setToolOutput('Choose a file first.')
      return
    }
    if (!toolInput.trim() && tool !== 'analyze') {
      setToolOutput('Enter a request first.')
      return
    }

    setToolLoading(true)
    setToolOutput('')
    try {
      let filePayload: any = undefined
      if (selectedFile) {
        const fileError = validateSelectedFile(selectedFile)
        if (fileError) throw new Error(fileError)
        if (selectedFile.type.startsWith('image/')) {
          filePayload = {
            name: selectedFile.name,
            type: selectedFile.type,
            imageData: await readDataUrl(selectedFile)
          }
        } else {
          const text = await readText(selectedFile)
          if (text.length > 120000) throw new Error('Text file must contain 120,000 characters or fewer.')
          filePayload = {
            name: selectedFile.name,
            type: selectedFile.type || 'text/plain',
            text: text.slice(0, 120000)
          }
        }
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Your JARVIS session expired. Refresh the page and try again.')

      const response = await fetch('/api/tool', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + session.access_token
        },
        body: JSON.stringify({ tool, input: toolInput, file: filePayload })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Tool failed.')
      setToolOutput(String(data.output || 'No result.'))
    } catch (error: any) {
      setToolOutput('Error: ' + (error?.message || 'Tool failed.'))
    } finally {
      setToolLoading(false)
    }
  }

  function openTool(id: ToolId) {
    setTool(id)
    setToolInput('')
    setToolOutput('')
    if (id === 'calendar') setCalendarMonth(new Date())
  }

  if (!user) {
    return (
      <div className="app-startup">
        <div className="startup-card">
          <div className="jarvis-mark">J</div>
          <h1>JARVIS</h1>
          {startupError ? (
            <>
              <p>{startupError}</p>
              <button className="primary-button" onClick={() => window.location.reload()}>Retry</button>
            </>
          ) : <p>Starting your assistant…</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="jarvis-app">
      <aside className={'app-sidebar ' + (sidebarOpen ? 'open' : '')}>
        <div className="sidebar-top">
          <button className="brand-button" onClick={() => navigate('chat')} aria-label="Go to chat">
            <span className="brand-mark">J</span>
            <span className="brand-name">JARVIS</span>
          </button>
          <button className="new-chat-button" onClick={() => createConversation()}><span>＋</span> New chat</button>
        </div>

        <div className="sidebar-scroll">
          <div className="sidebar-section-label">Workspace</div>
          <nav className="sidebar-nav">
            {sections.map(([id, label, icon]) => (
              <button key={id} className={section === id ? 'selected' : ''} onClick={() => navigate(id)}>
                <span>{icon}</span>{label}
              </button>
            ))}
          </nav>

          <div className="sidebar-section-label recent-label">Recent chats</div>
          <div className="conversation-list">
            {conversations.map(item => (
              <button
                key={item.id}
                className={'conversation-item ' + (conversation?.id === item.id ? 'selected' : '')}
                onClick={() => selectConversation(item)}
                title={item.title}
              >
                <span>{item.title || 'New chat'}</span>
              </button>
            ))}
            {!conversations.length && <div className="empty-sidebar">No conversations yet.</div>}
          </div>
        </div>

        <div className="sidebar-bottom">
          <button className="account-row" onClick={() => navigate('settings')}>
            <span className="avatar">{(settings.displayName || 'U').slice(0, 1).toUpperCase()}</span>
            <span className="account-copy"><b>{settings.displayName || 'User'}</b><small>{user.is_anonymous ? 'Anonymous account' : 'Account'}</small></span>
            <span>•••</span>
          </button>
        </div>
      </aside>

      {sidebarOpen && <button className="sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"/>}

      <main className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open menu">☰</button>
            <button className="model-button" onClick={() => navigate('settings')} title="Open assistant settings">
              <span className="mini-mark">J</span>
              <b>{settings.assistantName}</b>
              <small>GPT-5.6</small>
              <span className="chevron">⌄</span>
            </button>
          </div>
          <div className="topbar-actions">
            <button onClick={() => setMemoryOn(!memoryOn)} className={memoryOn ? 'top-action active' : 'top-action'} title="Toggle memory">
              ◈
            </button>
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="top-action" title="Toggle theme">
              {theme === 'dark' ? '☼' : '☾'}
            </button>
          </div>
        </header>

        <div className="app-body">
          {section === 'chat' && (
            <ChatPage
              assistantName={settings.assistantName}
              messages={messages}
              input={input}
              setInput={setInput}
              loading={loading}
              send={send}
              startVoice={startVoice}
              listening={listening}
              composerRef={composerRef}
              fileRef={fileRef}
              selectedFile={selectedFile}
              setSelectedFile={setSelectedFile}
              openTool={openTool}
              scrollRef={scrollRef}
            />
          )}
          {section === 'dashboard' && <DashboardPage messages={messages} conversations={conversations} tasks={tasks} memories={memories} navigate={navigate}/>}
          {section === 'tools' && <ToolsPage openTool={openTool}/>}
          {section === 'memory' && <MemoryPage memories={memories} memoryOn={memoryOn} setMemoryOn={setMemoryOn}/>}
          {section === 'tasks' && (
            <TasksPage
              tasks={tasks}
              setTasks={setTasks}
              taskInput={taskInput}
              setTaskInput={setTaskInput}
              taskDueDate={taskDueDate}
              setTaskDueDate={setTaskDueDate}
              addTask={addTask}
              calendarMonth={calendarMonth}
              setCalendarMonth={setCalendarMonth}
            />
          )}
          {section === 'files' && <FilesPage fileRef={fileRef} selectedFile={selectedFile} setSelectedFile={setSelectedFile} openTool={openTool}/>}
          {section === 'settings' && (
            <SettingsPage
              settings={settings}
              setSettings={setSettings}
              saveSettings={saveSettings}
              voiceOn={voiceOn}
              toggleVoice={toggleVoice}
              memoryOn={memoryOn}
              setMemoryOn={setMemoryOn}
              theme={theme}
              setTheme={setTheme}
            />
          )}
        </div>
      </main>

      {tool && (
        <ToolModal
          tool={tool}
          input={toolInput}
          setInput={setToolInput}
          output={toolOutput}
          loading={toolLoading}
          run={runTool}
          close={() => setTool(null)}
          fileRef={fileRef}
          selectedFile={selectedFile}
          setSelectedFile={setSelectedFile}
          navigate={navigate}
        />
      )}
    </div>
  )
}

function ChatPage(p: any) {
  const suggestions = [
    ['Search the web', 'Find current information online'],
    ['Plan my day', 'Help organize tasks and priorities'],
    ['Summarize something', 'Condense text into key points'],
    ['Explain a topic', 'Give me a clear explanation']
  ]

  return (
    <div className={'chat-page ' + (p.messages.length ? 'has-messages' : '')}>
      <div className="chat-scroll" ref={p.scrollRef}>
        {!p.messages.length ? (
          <div className="welcome">
            <div className="welcome-mark">J</div>
            <h1>How can I help you{p.assistantName ? ', ' + (p.assistantName === 'JARVIS' ? 'today' : 'today') : 'today'}?</h1>
            <p>Ask anything, or use one of the tools below.</p>
            <div className="suggestion-grid">
              {suggestions.map(([title, description]) => (
                <button key={title} onClick={() => p.send(title)}>
                  <b>{title}</b><small>{description}</small>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="message-list">
            {p.messages.map((message: Message) => (
              <article className={'message-row ' + message.role} key={message.id}>
                <div className="message-avatar">{message.role === 'assistant' ? 'J' : 'U'}</div>
                <div className="message-body">
                  <div className="message-meta">
                    <b>{message.role === 'assistant' ? p.assistantName : 'You'}</b>
                    <time>{formatTime(message.created_at)}</time>
                  </div>
                  <div className="message-text">{message.content}</div>
                </div>
              </article>
            ))}
            {p.loading && (
              <article className="message-row assistant">
                <div className="message-avatar">J</div>
                <div className="message-body">
                  <div className="message-meta"><b>{p.assistantName}</b><span>Thinking</span></div>
                  <div className="typing-dots"><i/><i/><i/></div>
                </div>
              </article>
            )}
          </div>
        )}
      </div>

      <div className="composer-area">
        {p.selectedFile && (
          <div className="attachment-chip">
            <span>□</span><b>{p.selectedFile.name}</b>
            <button onClick={() => p.setSelectedFile(null)} aria-label="Remove attachment">×</button>
          </div>
        )}
        <div className="composer">
          <button className="composer-tool" onClick={() => p.fileRef.current?.click()} title="Attach a file">＋</button>
          <textarea
            ref={p.composerRef}
            value={p.input}
            onChange={(event: any) => p.setInput(event.target.value)}
            onKeyDown={(event: any) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                p.send()
              }
            }}
            rows={1}
            placeholder="Message JARVIS"
            aria-label="Message JARVIS"
          />
          <button className={'composer-tool ' + (p.listening ? 'listening' : '')} onClick={p.startVoice} title="Voice input">
            {p.listening ? '■' : '◉'}
          </button>
          <button className="send-button" onClick={() => p.send()} disabled={!p.input.trim() || p.loading} title="Send message">
            ↑
          </button>
        </div>
        <div className="composer-tools">
          <button onClick={() => p.openTool('search')}>⌕ Web search</button>
          <button onClick={() => p.openTool('calculator')}>＋ Calculator</button>
          <button onClick={() => p.openTool('analyze')}>⌁ Analyze file</button>
        </div>
        <small className="disclaimer">JARVIS can make mistakes. Check important information.</small>
        <input
          ref={p.fileRef}
          type="file"
          hidden
          accept="image/*,.txt,.md,.csv,.json,.html,.css,.js,.jsx,.ts,.tsx"
          onChange={(event: any) => p.setSelectedFile(event.target.files?.[0] || null)}
        />
      </div>
    </div>
  )
}

function DashboardPage({ messages, conversations, tasks, memories, navigate }: any) {
  return (
    <Page title="Dashboard" subtitle="Your assistant activity at a glance.">
      <div className="stat-grid">
        <Stat label="Conversations" value={conversations.length}/>
        <Stat label="Messages" value={messages.length}/>
        <Stat label="Open tasks" value={tasks.filter((task: Task) => !task.done).length}/>
        <Stat label="Memories" value={memories.length}/>
      </div>
      <div className="content-card">
        <div className="card-title"><b>Quick access</b><span>Go somewhere</span></div>
        <div className="quick-actions">
          <button onClick={() => navigate('chat')}>Open chat</button>
          <button onClick={() => navigate('tasks')}>View tasks</button>
          <button onClick={() => navigate('tools')}>Open tools</button>
          <button onClick={() => navigate('memory')}>View memory</button>
        </div>
      </div>
      <div className="content-card">
        <div className="card-title"><b>Activity</b><span>Current session</span></div>
        <p className="muted-copy">{messages.length ? 'Your current chat has ' + messages.length + ' messages.' : 'No messages in this chat yet.'}</p>
        <p className="muted-copy">{tasks.length ? tasks.filter((task: Task) => task.done).length + ' of ' + tasks.length + ' tasks completed.' : 'No tasks have been created.'}</p>
      </div>
    </Page>
  )
}

function Stat({ label, value }: any) {
  return <div className="stat-card"><small>{label}</small><strong>{value}</strong></div>
}

function Page({ title, subtitle, children }: any) {
  return (
    <div className="page-scroll">
      <div className="page-heading"><h1>{title}</h1><p>{subtitle}</p></div>
      {children}
    </div>
  )
}

function ToolsPage({ openTool }: any) {
  return (
    <Page title="Tools" subtitle="Focused actions that run real code.">
      <div className="tool-grid">
        {tools.map(([id, name, icon, description]) => (
          <button className="tool-card" key={id} onClick={() => openTool(id)}>
            <span className="tool-icon">{icon}</span>
            <b>{name}</b>
            <small>{description}</small>
          </button>
        ))}
      </div>
    </Page>
  )
}

function MemoryPage({ memories, memoryOn, setMemoryOn }: any) {
  return (
    <Page title="Memory" subtitle="Control the persistent context JARVIS can use.">
      <div className="content-card setting-card">
        <div><b>Use memory in chats</b><small>Saved memories can be included when JARVIS answers.</small></div>
        <button className={'switch ' + (memoryOn ? 'on' : '')} onClick={() => setMemoryOn(!memoryOn)} aria-label="Toggle memory"><span/></button>
      </div>
      <div className="content-card">
        <div className="card-title"><b>Saved memories</b><span>{memories.length}</span></div>
        {memories.length ? memories.map((memory: string, index: number) => (
          <div className="memory-line" key={index}>{memory}</div>
        )) : <p className="muted-copy">No saved memories yet.</p>}
      </div>
    </Page>
  )
}

function TasksPage(p: any) {
  const first = new Date(p.calendarMonth.getFullYear(), p.calendarMonth.getMonth(), 1)
  const start = new Date(p.calendarMonth.getFullYear(), p.calendarMonth.getMonth(), 1 - first.getDay())
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
  const month = p.calendarMonth.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })

  return (
    <Page title="Tasks" subtitle="Create tasks and give them due dates.">
      <div className="task-compose">
        <input value={p.taskInput} onChange={(event: any) => p.setTaskInput(event.target.value)} onKeyDown={(event: any) => event.key === 'Enter' && p.addTask()} placeholder="Add a task"/>
        <input type="date" value={p.taskDueDate} onChange={(event: any) => p.setTaskDueDate(event.target.value)}/>
        <button onClick={p.addTask}>Add</button>
      </div>

      <div className="content-card calendar-card">
        <div className="calendar-toolbar">
          <button onClick={() => p.setCalendarMonth(new Date(p.calendarMonth.getFullYear(), p.calendarMonth.getMonth() - 1, 1))}>‹</button>
          <b>{month}</b>
          <button onClick={() => p.setCalendarMonth(new Date(p.calendarMonth.getFullYear(), p.calendarMonth.getMonth() + 1, 1))}>›</button>
        </div>
        <div className="calendar-week">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day: string) => <b key={day}>{day}</b>)}</div>
        <div className="calendar-grid">
          {days.map((date: Date) => {
            const key = dateKey(date)
            const dayTasks = p.tasks.filter((task: Task) => task.dueDate === key)
            return (
              <button key={key} className={'calendar-cell ' + (date.getMonth() === p.calendarMonth.getMonth() ? '' : 'outside') + (key === dateKey() ? ' today' : '')} onClick={() => {
                p.setTaskDueDate(key)
                if (dayTasks[0]) p.setTaskInput(dayTasks[0].text)
              }}>
                <span>{date.getDate()}</span>
                {dayTasks.length > 0 && <i>{dayTasks.length}</i>}
              </button>
            )
          })}
        </div>
      </div>

      <div className="content-card">
        <div className="card-title"><b>Task list</b><span>{p.tasks.length}</span></div>
        {p.tasks.length ? p.tasks.map((task: Task) => (
          <div className="task-row" key={task.id}>
            <button className={'check-button ' + (task.done ? 'done' : '')} onClick={() => p.setTasks((previous: Task[]) => previous.map(item => item.id === task.id ? { ...item, done: !item.done } : item))} aria-label="Toggle task">
              {task.done ? '✓' : ''}
            </button>
            <div className={task.done ? 'task-copy done-text' : 'task-copy'}><b>{task.text}</b>{task.dueDate && <small>Due {formatDay(task.dueDate + 'T12:00:00')}</small>}</div>
            <button className="delete-button" onClick={() => p.setTasks((previous: Task[]) => previous.filter(item => item.id !== task.id))} aria-label="Delete task">×</button>
          </div>
        )) : <p className="muted-copy">No tasks yet.</p>}
      </div>
    </Page>
  )
}

function FilesPage({ fileRef, selectedFile, setSelectedFile, openTool }: any) {
  return (
    <Page title="Files" subtitle="Attach text or image files to JARVIS tools.">
      <div className="content-card file-card">
        <div className="file-drop-icon">□</div>
        <h3>{selectedFile?.name || 'No file selected'}</h3>
        <p>Supported: images, TXT, Markdown, CSV, JSON, HTML, CSS, JS, TS and JSX/TSX.</p>
        <div className="file-actions">
          <button onClick={() => fileRef.current?.click()}>Choose file</button>
          <button onClick={() => openTool('analyze')} disabled={!selectedFile}>Analyze file</button>
          {selectedFile && <button onClick={() => setSelectedFile(null)}>Remove</button>}
        </div>
        <input
          ref={fileRef}
          hidden
          type="file"
          accept="image/*,.txt,.md,.csv,.json,.html,.css,.js,.jsx,.ts,.tsx"
          onChange={(event: any) => setSelectedFile(event.target.files?.[0] || null)}
        />
      </div>
    </Page>
  )
}

function SettingsPage(p: any) {
  return (
    <Page title="Settings" subtitle="Configure your JARVIS experience.">
      <div className="content-card form-card">
        <label>Display name<input value={p.settings.displayName} onChange={(event: any) => p.setSettings({ ...p.settings, displayName: event.target.value })}/></label>
        <label>Assistant name<input value={p.settings.assistantName} onChange={(event: any) => p.setSettings({ ...p.settings, assistantName: event.target.value })}/></label>
        <div className="setting-card"><div><b>Voice responses</b><small>Read JARVIS responses aloud.</small></div><button className={'switch ' + (p.voiceOn ? 'on' : '')} onClick={p.toggleVoice} aria-label="Toggle voice"><span/></button></div>
        <div className="setting-card"><div><b>Memory</b><small>Use saved memories in conversations.</small></div><button className={'switch ' + (p.memoryOn ? 'on' : '')} onClick={() => p.setMemoryOn(!p.memoryOn)} aria-label="Toggle memory"><span/></button></div>
        <div className="setting-card"><div><b>Theme</b><small>Switch between dark and light JARVIS modes.</small></div><button className="theme-choice" onClick={() => p.setTheme(p.theme === 'dark' ? 'light' : 'dark')}>{p.theme === 'dark' ? 'Dark' : 'Light'}</button></div>
        <button className="primary-button save-button" onClick={p.saveSettings}>Save settings</button>
      </div>
    </Page>
  )
}

function ToolModal(p: any) {
  const metadata: Record<ToolId, [string, string, string]> = {
    search: ['Web search', 'Search current information using JARVIS.', 'Search query…'],
    calculator: ['Calculator', 'Runs arithmetic locally in your browser.', 'Example: (250 / 4) + 12'],
    calendar: ['Calendar', 'Open your task calendar.', ''],
    summarize: ['Summarize', 'Paste text or attach a text file.', 'Paste text to summarize…'],
    translate: ['Translate', 'Paste text and specify the target language.', 'Example: Translate this to French: Hello'],
    analyze: ['Analyze file', 'Send a text or image file to JARVIS for analysis.', 'Optional instructions…']
  }
  const [name, hint, placeholder] = metadata[p.tool as ToolId]

  return (
    <div className="modal-layer" onClick={p.close}>
      <div className="tool-modal" onClick={(event: any) => event.stopPropagation()}>
        <div className="modal-heading"><div><small>JARVIS TOOL</small><h2>{name}</h2></div><button onClick={p.close} aria-label="Close">×</button></div>
        <p>{hint}</p>

        {p.tool === 'calendar' ? (
          <button className="primary-button full-button" onClick={() => { p.close(); p.navigate('tasks') }}>Open calendar</button>
        ) : (
          <>
            {p.tool === 'analyze' && (
              <div className="modal-file">
                <button onClick={() => p.fileRef.current?.click()}>Choose file</button>
                <span>{p.selectedFile?.name || 'No file selected'}</span>
                <input ref={p.fileRef} hidden type="file" accept="image/*,.txt,.md,.csv,.json,.html,.css,.js,.jsx,.ts,.tsx" onChange={(event: any) => p.setSelectedFile(event.target.files?.[0] || null)}/>
              </div>
            )}
            <textarea value={p.input} onChange={(event: any) => p.setInput(event.target.value)} placeholder={placeholder} rows={6}/>
            <button className="primary-button full-button" onClick={p.run} disabled={p.loading}>{p.loading ? 'Working…' : 'Run tool'}</button>
          </>
        )}

        {p.output && <pre className="tool-result">{p.output}</pre>}
      </div>
    </div>
  )
}
