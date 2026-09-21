'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '../lib/supabase/client'

type Section = 'chat' | 'dashboard' | 'tools' | 'memory' | 'tasks' | 'files' | 'settings'
type Message = { id: string; role: 'user' | 'assistant'; content: string; created_at: string }
type Conversation = { id: string; title: string; updated_at: string }
type Task = { id: string; text: string; done: boolean; createdAt: number; dueDate?: string }

const nav = [
  ['chat', 'Chat', '◌'],
  ['dashboard', 'Dashboard', '▦'],
  ['tools', 'Tools', '⌘'],
  ['memory', 'Memory', '◇'],
  ['tasks', 'Tasks', '☑'],
  ['files', 'Files', '□'],
  ['settings', 'Settings', '⚙']
] as const

const quick = [
  ['search', 'Search', '⌕', 'Search the web with JARVIS'],
  ['calculator', 'Calculator', '▦', 'Calculate an expression'],
  ['calendar', 'Calendar', '▣', 'Open your task calendar'],
  ['summarize', 'Summarize', '≡', 'Summarize text or a file'],
  ['translate', 'Translate', '文', 'Translate text'],
  ['analyze', 'Analyze', '⌁', 'Analyze a text or image file']
] as const

function localDateKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + d
}

export default function JarvisApp() {
  const supabase = useMemo(() => createClient(), [])
  const [user, setUser] = useState<any>(null)
  const [section, setSection] = useState<Section>('chat')
  const [sidebar, setSidebar] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [authError, setAuthError] = useState('')
  const [memoryOn, setMemoryOn] = useState(true)
  const [voiceOn, setVoiceOn] = useState(false)
  const [listening, setListening] = useState(false)
  const [tool, setTool] = useState<string | null>(null)
  const [toolInput, setToolInput] = useState('')
  const [toolOutput, setToolOutput] = useState('')
  const [toolLoading, setToolLoading] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskInput, setTaskInput] = useState('')
  const [taskDueDate, setTaskDueDate] = useState('')
  const [memories, setMemories] = useState<string[]>([])
  const [settings, setSettings] = useState({ displayName: '', assistantName: 'JARVIS' })
  const [fileName, setFileName] = useState('')
  const [clock, setClock] = useState(new Date())
  const [calendarMonth, setCalendarMonth] = useState(new Date())
  const recognitionRef = useRef<any>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      setTasks(JSON.parse(localStorage.getItem('jarvis_tasks') || '[]'))
    } catch {}
  }, [])

  useEffect(() => {
    localStorage.setItem('jarvis_tasks', JSON.stringify(tasks))
  }, [tasks])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        let currentUser = session?.user ?? null
        if (!currentUser) {
          const a = await supabase.auth.signInAnonymously()
          if (a.error) throw a.error
          currentUser = a.data.user
        }
        if (!currentUser) throw new Error('Could not create a JARVIS session.')
        setUser(currentUser)
        await loadConversations(currentUser.id)

        const { data: s } = await supabase
          .from('user_settings')
          .select('voice_enabled,display_name,assistant_name')
          .eq('user_id', currentUser.id)
          .maybeSingle()

        if (s) {
          setVoiceOn(!!s.voice_enabled)
          setSettings({ displayName: s.display_name || '', assistantName: s.assistant_name || 'JARVIS' })
        }

        const { data: m } = await supabase
          .from('memories')
          .select('memory')
          .eq('user_id', currentUser.id)
          .order('updated_at', { ascending: false })
          .limit(30)

        setMemories((m || []).map((x: any) => x.memory))
      } catch (e: any) {
        console.error(e)
        setAuthError(e?.message || 'Could not start JARVIS.')
      }
    })()
  }, [supabase])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function loadConversations(uid: string) {
    const { data } = await supabase
      .from('conversations')
      .select('id,title,updated_at')
      .eq('user_id', uid)
      .order('updated_at', { ascending: false })

    const list = (data || []) as Conversation[]
    setConversations(list)
    if (list.length) await selectConversation(list[0])
    else await newConversation(uid)
  }

  async function newConversation(uid = user?.id) {
    if (!uid) return
    const { data, error } = await supabase
      .from('conversations')
      .insert({ user_id: uid, title: 'New conversation' })
      .select('id,title,updated_at')
      .single()

    if (!error && data) {
      setConversations(p => [data as Conversation, ...p])
      setConversation(data as Conversation)
      setMessages([])
      setSection('chat')
      setSidebar(false)
    }
  }

  async function selectConversation(c: Conversation) {
    setConversation(c)
    const { data } = await supabase
      .from('messages')
      .select('id,role,content,created_at')
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: true })

    setMessages((data || []).filter((m: any) => m.role === 'user' || m.role === 'assistant') as Message[])
    setSection('chat')
    setSidebar(false)
  }

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim()
    if (!text || !conversation || loading) return

    const active = conversation
    const first = messages.length === 0
    setInput('')
    setLoading(true)
    setMessages(p => [
      ...p,
      { id: crypto.randomUUID(), role: 'user', content: text, created_at: new Date().toISOString() }
    ])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: active.id, message: text, memoryOn })
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Request failed')

      setMessages(p => [
        ...p,
        { id: crypto.randomUUID(), role: 'assistant', content: data.answer, created_at: new Date().toISOString() }
      ])

      if (first && user) {
        const title = text.length > 48 ? text.slice(0, 48).trim() + '…' : text
        await supabase
          .from('conversations')
          .update({ title, updated_at: new Date().toISOString() })
          .eq('id', active.id)
          .eq('user_id', user.id)
        setConversations(p => p.map(c => c.id === active.id ? { ...c, title } : c))
      }

      if (voiceOn && 'speechSynthesis' in window) {
        speechSynthesis.cancel()
        speechSynthesis.speak(new SpeechSynthesisUtterance(data.answer))
      }
    } catch (e: any) {
      setMessages(p => [
        ...p,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'I hit an error: ' + (e?.message || 'Something went wrong.'),
          created_at: new Date().toISOString()
        }
      ])
    } finally {
      setLoading(false)
    }
  }

  function openSection(next: Section) {
    setSection(next)
    setSidebar(false)
  }

  function openTool(id: string) {
    setTool(id)
    setToolInput('')
    setToolOutput('')
    if (id === 'calendar') {
      setCalendarMonth(new Date())
    }
  }

  async function runTool() {
    if (!tool) return

    if (tool === 'calculator') {
      if (!/^[0-9+\-*/().%\s]+$/.test(toolInput)) {
        setToolOutput('Use numbers and arithmetic operators only.')
        return
      }
      try {
        const result = Function('"use strict";return (' + toolInput + ')')()
        if (!Number.isFinite(Number(result))) throw new Error('Result is not finite.')
        setToolOutput(String(result))
      } catch {
        setToolOutput('Invalid expression.')
      }
      return
    }

    if (tool === 'calendar') {
      setTool(null)
      setSection('tasks')
      return
    }

    if (!toolInput.trim() && tool !== 'analyze') return

    setToolLoading(true)

    try {
      let filePayload: any = undefined

      if (tool === 'analyze' && fileRef.current?.files?.[0]) {
        const file = fileRef.current.files[0]
        setFileName(file.name)

        if (file.type.startsWith('image/')) {
          const imageData = await readFileAsDataUrl(file)
          filePayload = { name: file.name, type: file.type, imageData }
        } else if (file.type.startsWith('text/') || file.name.match(/\.(md|txt|csv|json|html|css|ts|tsx|js|jsx)$/i)) {
          const text = await readFileAsText(file)
          filePayload = { name: file.name, type: file.type || 'text/plain', text: text.slice(0, 120000) }
        } else {
          filePayload = { name: file.name, type: file.type, size: file.size }
        }
      }

      const res = await fetch('/api/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool, input: toolInput, file: filePayload })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Tool failed')
      setToolOutput(data.output || 'No result.')
    } catch (e: any) {
      setToolOutput('Error: ' + (e?.message || 'Tool failed.'))
    } finally {
      setToolLoading(false)
    }
  }

  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      alert('Speech recognition is not supported in this browser.')
      return
    }

    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }

    const r = new SR()
    r.lang = 'en-CA'
    r.interimResults = false
    r.onresult = (e: any) => setInput(e.results?.[0]?.[0]?.transcript || '')
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    recognitionRef.current = r
    setListening(true)
    r.start()
  }

  async function toggleVoice() {
    const next = !voiceOn
    setVoiceOn(next)
    if (user) {
      await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, voice_enabled: next, updated_at: new Date().toISOString() })
    }
  }

  async function saveSettings() {
    if (!user) return
    await supabase
      .from('user_settings')
      .upsert({
        user_id: user.id,
        display_name: settings.displayName,
        assistant_name: settings.assistantName || 'JARVIS',
        voice_enabled: voiceOn,
        updated_at: new Date().toISOString()
      })
  }

  function addTask() {
    const text = taskInput.trim()
    if (!text) return

    setTasks(p => [
      {
        id: crypto.randomUUID(),
        text,
        done: false,
        createdAt: Date.now(),
        dueDate: taskDueDate || undefined
      },
      ...p
    ])

    setTaskInput('')
    setTaskDueDate('')
  }

  if (!user) {
    return (
      <div className="loading-screen">
        {authError ? (
          <div className="startup-error">
            <h2>JARVIS could not start</h2>
            <p>{authError}</p>
            <button className="hud-button primary" onClick={() => location.reload()}>Retry</button>
          </div>
        ) : 'Initializing JARVIS…'}
      </div>
    )
  }

  return (
    <div className="jarvis-shell">
      <aside className={'hud-sidebar ' + (sidebar ? 'open' : '')}>
        <div className="brand">
          <div className="brand-orb">◯</div>
          <div><strong>JARVIS</strong><span>AI ASSISTANT</span></div>
        </div>

        <nav className="nav">
          {nav.map(([id, label, icon]) => (
            <button
              key={id}
              className={'nav-button ' + (section === id ? 'active' : '')}
              onClick={() => openSection(id)}
            >
              <i>{icon}</i>{label}
            </button>
          ))}
        </nav>

        <div className="online-card">
          <span className="status-dot"/>
          <div>
            <b>JARVIS Online</b>
            <small>Model: GPT-5.6</small>
            <small>Memory: {memoryOn ? 'Enabled' : 'Disabled'}</small>
          </div>
        </div>
      </aside>

      {sidebar && <div className="hud-backdrop" onClick={() => setSidebar(false)}/>}

      <main className="hud-main">
        <header className="hud-header">
          <button className="mobile-menu" onClick={() => setSidebar(true)} aria-label="Open navigation">☰</button>
          <div>
            <div className="eyebrow">{section.toUpperCase()}</div>
            <h1>
              {section === 'chat' ? 'Good evening.'
                : section === 'dashboard' ? 'Dashboard'
                : section === 'tools' ? 'Tools'
                : section === 'memory' ? 'Memory'
                : section === 'tasks' ? 'Tasks'
                : section === 'files' ? 'Files'
                : 'Settings'}
            </h1>
          </div>
          <div className="header-right">
            <span>{clock.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
            <strong>{clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong>
          </div>
        </header>

        <div className="hud-grid">
          <section className="hud-content">
            {section === 'chat' && (
              <ChatView
                messages={messages}
                loading={loading}
                input={input}
                setInput={setInput}
                send={send}
                startVoice={startVoice}
                listening={listening}
                conversations={conversations}
                conversation={conversation}
                selectConversation={selectConversation}
                newConversation={newConversation}
                bottomRef={bottomRef}
                assistantName={settings.assistantName}
                openSection={openSection}
              />
            )}

            {section === 'dashboard' && <DashboardView messages={messages} conversations={conversations} tasks={tasks} memories={memories} openSection={openSection}/>}
            {section === 'tools' && <ToolsView openTool={openTool}/>}
            {section === 'memory' && <MemoryView memories={memories} memoryOn={memoryOn} setMemoryOn={setMemoryOn}/>}
            {section === 'tasks' && (
              <TasksView
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
            {section === 'files' && <FilesView fileRef={fileRef} fileName={fileName} setFileName={setFileName} openTool={openTool}/>}
            {section === 'settings' && (
              <SettingsView
                settings={settings}
                setSettings={setSettings}
                saveSettings={saveSettings}
                voiceOn={voiceOn}
                toggleVoice={toggleVoice}
                memoryOn={memoryOn}
                setMemoryOn={setMemoryOn}
              />
            )}
          </section>

          <aside className="hud-right">
            <div className="panel status-panel">
              <h3>System Status</h3>
              {['AI Core', 'Tools', 'Memory', 'Web Search', 'Task Engine'].map(x => (
                <div className="status-row" key={x}>
                  <span><i className="status-dot"/> {x}</span>
                  <b>Online</b>
                </div>
              ))}
            </div>

            <div className="panel quick-panel">
              <h3>Quick Tools</h3>
              <div className="quick-grid">
                {quick.map(([id, label, icon, desc]) => (
                  <button key={id} title={desc} onClick={() => openTool(id)}>
                    <span>{icon}</span><small>{label}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="quote">
              “Intelligence is not a tool,<br/> it’s a partnership.”
              <small>— JARVIS</small>
            </div>
          </aside>
        </div>
      </main>

      <nav className="mobile-bottom-nav">
        <button className={section === 'chat' ? 'active' : ''} onClick={() => openSection('chat')}>◌<small>Chat</small></button>
        <button className={section === 'tools' ? 'active' : ''} onClick={() => openSection('tools')}>⌘<small>Tools</small></button>
        <button className={section === 'dashboard' ? 'active' : ''} onClick={() => openSection('dashboard')}>▦<small>Dashboard</small></button>
        <button className={section === 'tasks' ? 'active' : ''} onClick={() => openSection('tasks')}>☑<small>Tasks</small></button>
        <button onClick={() => setSidebar(true)}>☰<small>More</small></button>
      </nav>

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
          openSection={openSection}
          calendarMonth={calendarMonth}
          setCalendarMonth={setCalendarMonth}
          tasks={tasks}
        />
      )}
    </div>
  )
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'))
    reader.readAsText(file)
  })
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Could not read image.'))
    reader.readAsDataURL(file)
  })
}

function ChatView(p: any) {
  const suggestions = ['Search the web', 'Show my tasks', 'What’s on my calendar?', 'Help me plan my day']

  return (
    <div className="chat-view">
      {!p.messages.length ? (
        <div className="hero-welcome">
          <div className="big-orb">◯</div>
          <h2>How can I assist you today?</h2>
          <p>Ask JARVIS anything. Use the tools on the right for focused actions.</p>
        </div>
      ) : (
        <div className="chat-stream">
          {p.messages.map((m: Message) => (
            <div className={'chat-bubble ' + m.role} key={m.id}>
              <div className="bubble-name">{m.role === 'user' ? 'You' : p.assistantName}</div>
              <div>{m.content}</div>
            </div>
          ))}
          {p.loading && (
            <div className="chat-bubble assistant">
              <div className="bubble-name">{p.assistantName}</div>
              <div className="typing">Thinking…</div>
            </div>
          )}
          <div ref={p.bottomRef}/>
        </div>
      )}

      <div className="suggestions">
        {suggestions.map((q: string) => (
          <button
            key={q}
            onClick={() => q === 'Show my tasks' || q === 'What’s on my calendar?'
              ? p.openSection('tasks')
              : p.send(q)}
          >
            {q}
          </button>
        ))}
      </div>

      <div className="composer-hud">
        <button onClick={p.startVoice} aria-label="Voice input">{p.listening ? '■' : '◉'}</button>
        <textarea
          value={p.input}
          onChange={e => p.setInput(e.target.value)}
          onKeyDown={(e: any) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              p.send()
            }
          }}
          placeholder="Type a message to JARVIS…"
          rows={1}
        />
        <button className="send-button" onClick={() => p.send()} disabled={!p.input.trim() || p.loading} aria-label="Send message">➤</button>
      </div>

      <div className="chat-foot">JARVIS can make mistakes. Check important information.</div>
    </div>
  )
}

function DashboardView({ messages, conversations, tasks, memories, openSection }: any) {
  return (
    <div className="panel-page">
      <div className="page-title">
        <h2>Command center.</h2>
        <p>Your JARVIS activity at a glance.</p>
      </div>

      <div className="metric-grid">
        <Metric label="Conversations" value={conversations.length}/>
        <Metric label="Messages" value={messages.length}/>
        <Metric label="Tasks" value={tasks.length}/>
        <Metric label="Memory items" value={memories.length}/>
      </div>

      <div className="dashboard-actions">
        <button onClick={() => openSection('chat')}>Open Chat</button>
        <button onClick={() => openSection('tasks')}>Open Tasks</button>
        <button onClick={() => openSection('memory')}>Open Memory</button>
        <button onClick={() => openSection('tools')}>Open Tools</button>
      </div>

      <div className="panel activity">
        <h3>Recent activity</h3>
        <p>{messages.length ? 'Your current conversation contains ' + messages.length + ' messages.' : 'No activity yet. Start a conversation.'}</p>
        <p>{tasks.length ? tasks.filter((t: Task) => t.done).length + ' of ' + tasks.length + ' tasks completed.' : 'No tasks created yet.'}</p>
      </div>
    </div>
  )
}

function Metric({ label, value }: any) {
  return <div className="metric"><small>{label}</small><strong>{value}</strong></div>
}

function ToolsView({ openTool }: any) {
  return (
    <div className="panel-page">
      <div className="page-title">
        <h2>Tools</h2>
        <p>Every control below launches a real coded action.</p>
      </div>
      <div className="tool-cards">
        {quick.map(([id, label, icon, desc]) => (
          <button className="tool-card" key={id} onClick={() => openTool(id)}>
            <span>{icon}</span><b>{label}</b><small>{desc}</small>
          </button>
        ))}
      </div>
    </div>
  )
}

function MemoryView({ memories, memoryOn, setMemoryOn }: any) {
  return (
    <div className="panel-page">
      <div className="page-title">
        <h2>Memory</h2>
        <p>Control what JARVIS uses as persistent context.</p>
      </div>
      <div className="panel setting-row">
        <div><b>Memory for conversations</b><small>Use saved memories when answering.</small></div>
        <button className={'toggle ' + (memoryOn ? 'on' : '')} onClick={() => setMemoryOn(!memoryOn)} aria-label="Toggle memory"><span/></button>
      </div>
      <div className="panel memory-list">
        <h3>Saved memories</h3>
        {memories.length ? memories.map((m: string, i: number) => <div className="memory-item" key={i}>{m}</div>) : <p>No memories saved yet.</p>}
      </div>
    </div>
  )
}

function TasksView({ tasks, setTasks, taskInput, setTaskInput, taskDueDate, setTaskDueDate, addTask, calendarMonth, setCalendarMonth }: any) {
  const monthLabel = calendarMonth.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
  const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1)
  const start = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1 - firstDay.getDay())
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })

  const tasksForDay = (key: string) => tasks.filter((t: Task) => t.dueDate === key)

  return (
    <div className="panel-page">
      <div className="page-title">
        <h2>Tasks & Calendar</h2>
        <p>Tasks are stored on this device and can have due dates.</p>
      </div>

      <div className="task-add">
        <input value={taskInput} onChange={e => setTaskInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTask()} placeholder="Add a task…"/>
        <input type="date" value={taskDueDate} onChange={e => setTaskDueDate(e.target.value)} aria-label="Task due date"/>
        <button onClick={addTask}>Add</button>
      </div>

      <div className="calendar-panel panel">
        <div className="calendar-head">
          <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>‹</button>
          <strong>{monthLabel}</strong>
          <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>›</button>
        </div>

        <div className="calendar-week">
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <b key={d}>{d}</b>)}
        </div>

        <div className="calendar-grid">
          {days.map(d => {
            const key = localDateKey(d)
            const inMonth = d.getMonth() === calendarMonth.getMonth()
            const dayTasks = tasksForDay(key)
            return (
              <button
                key={key}
                className={'calendar-day ' + (inMonth ? '' : 'muted') + (key === localDateKey() ? ' today' : '')}
                onClick={() => {
                  setTaskDueDate(key)
                  setTaskInput(dayTasks[0]?.text || '')
                }}
                title={dayTasks.length ? dayTasks.map((t: Task) => t.text).join(', ') : 'Set due date to ' + key}
              >
                <span>{d.getDate()}</span>
                {dayTasks.length > 0 && <i>{dayTasks.length}</i>}
              </button>
            )
          })}
        </div>
      </div>

      <div className="panel task-list">
        <h3>Task list</h3>
        {tasks.length ? tasks.map((t: Task) => (
          <div className="task-item" key={t.id}>
            <button
              onClick={() => setTasks((p: Task[]) => p.map(x => x.id === t.id ? { ...x, done: !x.done } : x))}
              className={'check ' + (t.done ? 'done' : '')}
              aria-label={t.done ? 'Mark task incomplete' : 'Mark task complete'}
            >{t.done ? '✓' : ''}</button>
            <span className={t.done ? 'done-text' : ''}>
              {t.text}{t.dueDate ? <small className="task-due">Due {t.dueDate}</small> : null}
            </span>
            <button className="delete" onClick={() => setTasks((p: Task[]) => p.filter(x => x.id !== t.id))} aria-label="Delete task">×</button>
          </div>
        )) : <p>No tasks yet.</p>}
      </div>
    </div>
  )
}

function FilesView({ fileRef, fileName, setFileName, openTool }: any) {
  return (
    <div className="panel-page">
      <div className="page-title">
        <h2>Files</h2>
        <p>Select a file. Analyze reads text files and sends image files as image input to the AI.</p>
      </div>

      <div className="panel upload-box">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.txt,.md,.csv,.json,.html,.css,.js,.jsx,.ts,.tsx"
          onChange={e => setFileName(e.target.files?.[0]?.name || '')}
        />
        <div className="upload-icon">□</div>
        <b>{fileName || 'No file selected'}</b>
        <small>File contents are processed by JARVIS when Analyze is run.</small>
        <button onClick={() => openTool('analyze')} disabled={!fileName}>Analyze selected file</button>
      </div>
    </div>
  )
}

function SettingsView({ settings, setSettings, saveSettings, voiceOn, toggleVoice, memoryOn, setMemoryOn }: any) {
  return (
    <div className="panel-page">
      <div className="page-title">
        <h2>Settings</h2>
        <p>Configure your JARVIS experience.</p>
      </div>

      <div className="panel form-panel">
        <label>Display name
          <input value={settings.displayName} onChange={e => setSettings({ ...settings, displayName: e.target.value })}/>
        </label>

        <label>Assistant name
          <input value={settings.assistantName} onChange={e => setSettings({ ...settings, assistantName: e.target.value })}/>
        </label>

        <div className="setting-row">
          <div><b>Voice responses</b><small>Speak JARVIS responses aloud.</small></div>
          <button className={'toggle ' + (voiceOn ? 'on' : '')} onClick={toggleVoice} aria-label="Toggle voice responses"><span/></button>
        </div>

        <div className="setting-row">
          <div><b>Memory</b><small>Use persistent memories in chats.</small></div>
          <button className={'toggle ' + (memoryOn ? 'on' : '')} onClick={() => setMemoryOn(!memoryOn)} aria-label="Toggle memory"><span/></button>
        </div>

        <button className="hud-button primary" onClick={saveSettings}>Save settings</button>
      </div>
    </div>
  )
}

function ToolModal({ tool, input, setInput, output, loading, run, close, fileRef, openSection, calendarMonth, setCalendarMonth, tasks }: any) {
  const names: any = {
    search: 'Web Search',
    calculator: 'Calculator',
    calendar: 'Calendar',
    summarize: 'Summarize',
    translate: 'Translate',
    analyze: 'Analyze'
  }

  const hints: any = {
    search: 'Search the web using JARVIS web search.',
    calculator: 'Calculate locally in your browser. Example: (250 / 4) + 12',
    calendar: 'View and manage your dated tasks.',
    summarize: 'Paste text or choose a text file to summarize.',
    translate: 'Paste text and specify the target language.',
    analyze: 'Choose a text or image file. The actual contents are sent for analysis.'
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="tool-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div><span className="eyebrow">JARVIS TOOL</span><h2>{names[tool]}</h2></div>
          <button onClick={close} aria-label="Close tool">×</button>
        </div>

        <p className="modal-hint">{hints[tool]}</p>

        {tool === 'analyze' && (
          <input
            ref={fileRef}
            type="file"
            className="file-input"
            accept="image/*,.txt,.md,.csv,.json,.html,.css,.js,.jsx,.ts,.tsx"
          />
        )}

        {tool === 'calendar' ? (
          <div className="modal-calendar">
            <div className="calendar-head">
              <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>‹</button>
              <strong>{calendarMonth.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })}</strong>
              <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>›</button>
            </div>
            <p>{tasks.filter((t: Task) => t.dueDate).length} dated task(s). Use Tasks to add or edit them.</p>
            <button className="hud-button primary" onClick={() => { close(); openSection('tasks') }}>Open full calendar</button>
          </div>
        ) : (
          <>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={tool === 'translate' ? 'Translate this to French…' : 'Enter your request…'}
              rows={6}
            />
            <button className="hud-button primary" onClick={run} disabled={loading}>
              {loading ? 'Working…' : 'Run tool'}
            </button>
          </>
        )}

        {tool !== 'calendar' && output && <div className="tool-output">{output}</div>}
      </div>
    </div>
  )
}
