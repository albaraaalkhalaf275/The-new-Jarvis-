import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'

type AgentToolCall = {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

function safeCalculate(expression: string) {
  const cleaned = expression.replace(/,/g, '').trim()
  if (!/^[0-9+\-*/().%\s]+$/.test(cleaned)) throw new Error('Only basic arithmetic is supported.')
  const value = Function('"use strict"; return (' + cleaned + ')')()
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid calculation.')
  return String(value)
}

export async function POST(req: Request) {
  try {
    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || undefined
    const supabase = await createClient(bearer)
    const { data: claims } = await supabase.auth.getClaims(bearer)
    const userId = claims?.claims?.sub as string | undefined
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const conversationId = String(body.conversationId || '')
    const message = String(body.message || '').trim()
    if (!conversationId || !message) return NextResponse.json({ error: 'Missing message' }, { status: 400 })

    const { data: conversation } = await supabase
      .from('conversations').select('id,title').eq('id', conversationId).eq('user_id', userId).single()
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

    const { data: history } = await supabase
      .from('messages').select('role,content').eq('conversation_id', conversationId)
      .order('created_at', { ascending: true }).limit(50)

    await supabase.from('messages').insert({
      conversation_id: conversationId, user_id: userId, role: 'user', content: message
    })

    const { data: memories } = await supabase
      .from('memories').select('id,memory').eq('user_id', userId)
      .order('updated_at', { ascending: false }).limit(30)

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json({
        error: 'JARVIS is missing its OpenAI API key on the server. Add OPENAI_API_KEY to the Vercel project environment variables and redeploy.'
      }, { status: 503 })
    }

    const client = new OpenAI({ apiKey })
    const model = process.env.OPENAI_MODEL || 'gpt-5.6-luna'
    const memoryContext = body.memoryOn === false
      ? 'Memory is disabled for this chat.'
      : (memories?.map(x => `- [${x.id}] ${x.memory}`).join('\n') || 'No saved memories.')

    const instructions = `You are JARVIS, a capable personal AI assistant.
Be precise, direct, useful, and honest.
You can use tools when they materially help. Do not claim an action happened unless a tool actually completed it.
Use calculator for arithmetic instead of doing complex arithmetic mentally.
Use web search when the user asks for current, changing, or externally verified information.
Use memory tools when the user asks you to remember/forget something or when a durable preference, fact, or recurring detail is clearly worth remembering. Do not save sensitive information unless the user explicitly asks you to remember it.
When saving memory, store a short factual statement that will be useful in future conversations.
Current saved memories:
${memoryContext}`

    let input: any[] = [
      ...(history || []).map((m: any) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: [{ type: 'input_text', text: String(m.content) }]
      })),
      { role: 'user', content: [{ type: 'input_text', text: message }] }
    ]

    const tools: any[] = [
      {
        type: 'web_search',
        search_context_size: 'medium'
      },
      {
        type: 'function',
        name: 'calculator',
        description: 'Calculate a basic arithmetic expression accurately.',
        parameters: {
          type: 'object',
          properties: { expression: { type: 'string', description: 'Arithmetic expression using numbers and + - * / % parentheses.' } },
          required: ['expression'],
          additionalProperties: false
        }
      },
      {
        type: 'function',
        name: 'save_memory',
        description: 'Save a durable, non-sensitive user fact or preference for future conversations.',
        parameters: {
          type: 'object',
          properties: { memory: { type: 'string', description: 'Short factual memory to save.' } },
          required: ['memory'],
          additionalProperties: false
        }
      },
      {
        type: 'function',
        name: 'search_memory',
        description: 'Search the user\'s saved memories for relevant information.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'What to look for in saved memories.' } },
          required: ['query'],
          additionalProperties: false
        }
      },
      {
        type: 'function',
        name: 'forget_memory',
        description: 'Delete a saved memory when the user explicitly asks JARVIS to forget it.',
        parameters: {
          type: 'object',
          properties: { memory_id: { type: 'string', description: 'ID of the memory to delete.' } },
          required: ['memory_id'],
          additionalProperties: false
        }
      }
    ]

    let answer = ''
    for (let turn = 0; turn < 6; turn++) {
      const response = await client.responses.create({
        model,
        instructions,
        input,
        tools
      } as any)

      const calls = (response.output || []).filter((item: any): item is AgentToolCall => item?.type === 'function_call')
      answer = response.output_text || ''

      if (!calls.length) break

      input = [...input, ...response.output]

      for (const call of calls) {
        let output = ''
        try {
          const args = JSON.parse(call.arguments || '{}')

          if (call.name === 'calculator') {
            output = safeCalculate(String(args.expression || ''))
          } else if (call.name === 'save_memory') {
            if (body.memoryOn === false) {
              output = 'Memory is disabled, so nothing was saved.'
            } else {
              const memory = String(args.memory || '').trim()
              if (!memory) throw new Error('Memory text is empty.')
              const { data, error } = await supabase.from('memories').insert({
                user_id: userId, memory
              }).select('id,memory').single()
              if (error) throw error
              output = JSON.stringify({ saved: true, memory: data })
            }
          } else if (call.name === 'search_memory') {
            const query = String(args.query || '').toLowerCase()
            const matches = (memories || []).filter(m => String(m.memory).toLowerCase().includes(query))
            output = JSON.stringify(matches.slice(0, 10))
          } else if (call.name === 'forget_memory') {
            const memoryId = String(args.memory_id || '')
            const { error } = await supabase.from('memories')
              .delete().eq('id', memoryId).eq('user_id', userId)
            if (error) throw error
            output = JSON.stringify({ deleted: true, memory_id: memoryId })
          } else {
            output = 'Unknown tool.'
          }
        } catch (toolError: any) {
          output = JSON.stringify({ error: toolError?.message || 'Tool execution failed.' })
        }

        input.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output
        })
      }
    }

    if (!answer) answer = 'I could not generate a response.'

    await supabase.from('messages').insert({
      conversation_id: conversationId, user_id: userId, role: 'assistant', content: answer
    })
    await supabase.from('conversations').update({
      updated_at: new Date().toISOString()
    }).eq('id', conversationId).eq('user_id', userId)

    return NextResponse.json({ answer })
  } catch (e: any) {
    console.error('JARVIS agent error:', e)
    const status = Number(e?.status) || 500
    const errorMessage = e?.error?.message || e?.message || 'Server error'
    return NextResponse.json(
      { error: errorMessage },
      { status: status >= 400 && status < 600 ? status : 500 }
    )
  }
}
