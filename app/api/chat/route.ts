import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { runJarvisAgent } from '../../../lib/agent/jarvis'
import { getClientIp, rateLimit, rejectIfTooLarge, safeError, secureJson, validateRequestOrigin } from '../../../lib/security'
import { z } from 'zod'

const ChatSchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1).max(20_000),
  memoryOn: z.boolean().optional()
}).strict()

const MAX_BODY_BYTES = 64 * 1024

export async function POST(req: Request) {
  try {
    const tooLarge = rejectIfTooLarge(req, MAX_BODY_BYTES)
    if (tooLarge) return tooLarge
    if (!validateRequestOrigin(req)) return secureJson({ error: 'Invalid request origin.' }, { status: 403 })

    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || undefined
    if (!bearer || bearer.length > 5000) return secureJson({ error: 'Unauthorized' }, { status: 401 })

    const supabase = await createClient(bearer)
    const { data: claims } = await supabase.auth.getClaims(bearer)
    const userId = claims?.claims?.sub as string | undefined
    if (!userId) return secureJson({ error: 'Unauthorized' }, { status: 401 })

    const ip = getClientIp(req)
    const limit = rateLimit(`chat:${userId}:${ip}`, 'chat')
    if (!limit.allowed) {
      const response = secureJson({ error: 'Too many requests. Please wait before sending another message.' }, { status: 429 })
      response.headers.set('Retry-After', String(limit.retryAfter))
      return response
    }

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return secureJson({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    const parsed = ChatSchema.safeParse(raw)
    if (!parsed.success) return secureJson({ error: 'Invalid request.' }, { status: 400 })

    const { conversationId, message, memoryOn } = parsed.data

    const { data: conversation } = await supabase
      .from('conversations')
      .select('id,title')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single()

    if (!conversation) return secureJson({ error: 'Conversation not found' }, { status: 404 })

    const { data: history } = await supabase
      .from('messages')
      .select('role,content')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
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
      return secureJson({
        error: 'JARVIS is not configured yet. The server is missing its OpenAI API key.'
      }, { status: 503 })
    }

    const result = await runJarvisAgent({
      message,
      history: (history || []).map((item: any) => ({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: String(item.content).slice(0, 20_000)
      })),
      memories: (memories || []).map((item: any) => ({
        id: String(item.id),
        memory: String(item.memory).slice(0, 5_000)
      })),
      supabase,
      userId,
      memoryOn: memoryOn !== false
    })

    const answer = String(result.answer || 'I could not generate a response.').slice(0, 30_000)

    const { error: assistantMessageError } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      user_id: userId,
      role: 'assistant',
      content: answer
    })

    if (assistantMessageError) throw assistantMessageError

    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('user_id', userId)

    return secureJson({ answer })
  } catch (e: any) {
    console.error('JARVIS agent error:', e)
    const status = Number(e?.status)
    return secureJson(
      { error: safeError(e) },
      { status: status >= 400 && status < 600 ? status : 500 }
    )
  }
}
