import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { runJarvisAgent } from '../../../lib/agent/jarvis'

export async function POST(req: Request) {
  try {
    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || undefined
    const supabase = await createClient(bearer)
    const { data: claims } = await supabase.auth.getClaims(bearer)
    const userId = claims?.claims?.sub as string | undefined

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const conversationId = String(body.conversationId || '')
    const message = String(body.message || '').trim()

    if (!conversationId || !message) {
      return NextResponse.json({ error: 'Missing message' }, { status: 400 })
    }

    const { data: conversation } = await supabase
      .from('conversations')
      .select('id,title')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single()

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const { data: history } = await supabase
      .from('messages')
      .select('role,content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(50)

    const { error: userMessageError } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      user_id: userId,
      role: 'user',
      content: message
    })

    if (userMessageError) throw userMessageError

    const { data: memories } = await supabase
      .from('memories')
      .select('id,memory')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(100)

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({
        error: 'JARVIS is missing its OpenAI API key on the server. Add OPENAI_API_KEY to the Vercel project environment variables and redeploy.'
      }, { status: 503 })
    }

    const result = await runJarvisAgent({
      message,
      history: (history || []).map((item: any) => ({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: String(item.content)
      })),
      memories: (memories || []).map((item: any) => ({
        id: String(item.id),
        memory: String(item.memory)
      })),
      supabase,
      userId,
      memoryOn: body.memoryOn !== false
    })

    const { error: assistantMessageError } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      user_id: userId,
      role: 'assistant',
      content: result.answer
    })

    if (assistantMessageError) throw assistantMessageError

    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('user_id', userId)

    return NextResponse.json({ answer: result.answer })
  } catch (e: any) {
    console.error('JARVIS agent error:', e)

    const status = Number(e?.status) || 500
    const errorMessage =
      e?.error?.message ||
      e?.message ||
      'JARVIS agent failed.'

    return NextResponse.json(
      { error: errorMessage },
      { status: status >= 400 && status < 600 ? status : 500 }
    )
  }
}
