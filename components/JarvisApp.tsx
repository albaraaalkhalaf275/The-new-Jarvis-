'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '../lib/supabase/client'
import { useRouter } from 'next/navigation'

type Message={id:string;role:'user'|'assistant'|'system';content:string;created_at:string}
type Conversation={id:string;title:string;updated_at:string}

export default function JarvisApp(){
  const supabase=createClient()
  const [user,setUser]=useState<any>(null)
  const [conversations,setConversations]=useState<Conversation[]>([])
  const [conversation,setConversation]=useState<Conversation|null>(null)
  const [messages,setMessages]=useState<Message[]>([])
  const [input,setInput]=useState('')
  const [loading,setLoading]=useState(false)
  const [sidebar,setSidebar]=useState(false)
  const [memoryOn,setMemoryOn]=useState(true)
  const [voiceOn,setVoiceOn]=useState(false)
  const [listening,setListening]=useState(false)
  const recognitionRef=useRef<any>(null)
  const bottomRef=useRef<HTMLDivElement>(null)

  useEffect(()=>{(async()=>{
    let {data}=await supabase.auth.getUser()
    if(!data.user){
      const anonymous=await supabase.auth.signInAnonymously()
      if(anonymous.error){console.error(anonymous.error);return}
      data={user:anonymous.data.user}
    }
    setUser(data.user)
    await loadConversations(data.user.id)
    const {data:s}=await supabase.from('user_settings').select('voice_enabled').eq('user_id',data.user.id).maybeSingle()
    if(s)setVoiceOn(!!s.voice_enabled)
  })()},[])

  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:'smooth'})},[messages,loading])

  async function loadConversations(uid:string){
    const {data}=await supabase.from('conversations').select('id,title,updated_at').eq('user_id',uid).order('updated_at',{ascending:false})
    const list=(data||[]) as Conversation[]
    setConversations(list)
    if(!conversation && list[0]) await selectConversation(list[0])
    if(!list.length) await newConversation(uid)
  }

  async function newConversation(uid=user?.id){
    if(!uid)return
    const {data,error}=await supabase.from('conversations').insert({user_id:uid,title:'New chat'}).select('id,title,updated_at').single()
    if(!error&&data){setConversations(p=>[data as Conversation,...p]);setConversation(data as Conversation);setMessages([]);setSidebar(false)}
  }

  async function selectConversation(c:Conversation){
    setConversation(c);setSidebar(false)
    const {data}=await supabase.from('messages').select('id,role,content,created_at').eq('conversation_id',c.id).order('created_at',{ascending:true})
    setMessages((data||[]) as Message[])
  }

  async function send(){
    const text=input.trim()
    if(!text||!conversation||loading)return
    const active=conversation
    const first=messages.length===0
    setInput('');setLoading(true)
    setMessages(p=>[...p,{id:crypto.randomUUID(),role:'user',content:text,created_at:new Date().toISOString()}])
    try{
      const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:active.id,message:text,memoryOn})})
      const data=await res.json()
      if(!res.ok||data.error)throw new Error(data.error||'Request failed')
      setMessages(p=>[...p,{id:crypto.randomUUID(),role:'assistant',content:data.answer,created_at:new Date().toISOString()}])
      if(first){
        const title=text.length>42?text.slice(0,42).trim()+'…':text
        await supabase.from('conversations').update({title,updated_at:new Date().toISOString()}).eq('id',active.id).eq('user_id',user.id)
      }
      if(voiceOn&&'speechSynthesis'in window)speechSynthesis.speak(new SpeechSynthesisUtterance(data.answer))
    }catch(e:any){
      setMessages(p=>[...p,{id:crypto.randomUUID(),role:'assistant',content:'Error: '+(e?.message||'Something went wrong.'),created_at:new Date().toISOString()}])
    }finally{setLoading(false);if(user)loadConversations(user.id)}
  }

  function startVoice(){
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition
    if(!SR){alert('Speech recognition is not supported in this browser.');return}
    if(listening){recognitionRef.current?.stop();setListening(false);return}
    const r=new SR();r.lang='en-CA';r.interimResults=false
    r.onresult=(e:any)=>setInput(e.results?.[0]?.[0]?.transcript||'')
    r.onend=()=>setListening(false);r.onerror=()=>setListening(false)
    recognitionRef.current=r;setListening(true);r.start()
  }

  async function toggleVoice(){
    const next=!voiceOn;setVoiceOn(next)
    if(user)await supabase.from('user_settings').upsert({user_id:user.id,voice_enabled:next,updated_at:new Date().toISOString()})
  }

  if(!user)return <div className="loading-screen">Loading JARVIS…</div>

  return <div className="app-shell">
    <aside className={'sidebar '+(sidebar?'open':'')}>
      <div className="side-top"><b>JARVIS</b><button onClick={()=>setSidebar(false)}>×</button></div>
      <button className="new-chat" onClick={()=>newConversation()}>＋ New chat</button>
      <div className="side-section">Chats</div>
      <div className="chat-list">{conversations.map(c=><button key={c.id} className={'chat-item '+(conversation?.id===c.id?'active':'')} onClick={()=>selectConversation(c)}>{c.title}</button>)}</div>
      <div className="side-bottom">
        <button className="side-control" onClick={()=>setMemoryOn(!memoryOn)}>Memory <b>{memoryOn?'ON':'OFF'}</b></button>
        <button className="side-control" onClick={toggleVoice}>Voice <b>{voiceOn?'ON':'OFF'}</b></button>
        <div className="side-control">Intelligence <b>GPT-5.6</b></div>
      </div>
    </aside>
    {sidebar&&<div className="backdrop" onClick={()=>setSidebar(false)}/>}
    <main className="main">
      <header className="topbar"><button className="menu" onClick={()=>setSidebar(true)}>☰</button><b>JARVIS</b><span className="online">● Online</span><button className="new-small" onClick={()=>newConversation()}>＋</button></header>
      <section className="messages">
        {!messages.length?<div className="welcome"><div className="orb">J</div><h1>How can I help?</h1><p>Ask JARVIS anything.</p></div>:messages.map(m=><div key={m.id} className={'message-row '+m.role}><small>{m.role==='user'?'You':'JARVIS'}</small><div className="message">{m.content}</div></div>)}
        {loading&&<div className="message-row assistant"><small>JARVIS</small><div className="message">Thinking…</div></div>}
        <div ref={bottomRef}/>
      </section>
      <div className="composer-wrap"><div className="composer"><button onClick={startVoice}>{listening?'■':'◉'}</button><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}} placeholder="Message JARVIS…" rows={1}/><button onClick={send} disabled={!input.trim()||loading}>↑</button></div><div className="hint">JARVIS can make mistakes. Check important information.</div></div>
    </main>
  </div>
}