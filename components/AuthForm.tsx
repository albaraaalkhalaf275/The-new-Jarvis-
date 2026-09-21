'use client'
import { FormEvent, useRef, useState } from 'react'
import { createClient } from '../lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function AuthForm({mode}:{mode:'login'|'signup'}) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  const router = useRouter()

  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient()
    return supabaseRef.current
  }
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(false)

  async function submit(e:FormEvent){
    e.preventDefault(); setLoading(true); setError('')
    const supabase = getSupabase()
    const result = mode==='login'
      ? await supabase.auth.signInWithPassword({email,password})
      : await supabase.auth.signUp({email,password})
    if(result.error){setError(result.error.message);setLoading(false);return}
    router.push('/')
    setLoading(false)
  }

  return <main className="auth-shell">
    <form className="auth-card" onSubmit={submit}>
      <div className="brand">JARVIS</div>
      <h1>{mode==='login'?'Welcome back':'Create your account'}</h1>
      <p className="muted">{mode==='login'?'Sign in to continue.':'Your conversations and memories stay tied to your account.'}</p>
      <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="Email" required />
      <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Password" minLength={6} required />
      {error && <div className="error">{error}</div>}
      <button className="primary" disabled={loading}>{loading?'Please wait…':mode==='login'?'Sign in':'Create account'}</button>
      <button type="button" className="text-button" onClick={()=>router.push(mode==='login'?'/signup':'/login')}>
        {mode==='login'?'Create an account':'Already have an account? Sign in'}
      </button>
    </form>
  </main>
}