import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'

type ToolRequest = {
  tool: string
  input?: string
  file?: {
    name: string
    type: string
    text?: string
    imageData?: string
    size?: number
  }
}

export async function POST(req: Request) {
  try {
    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || undefined
    const supabase = await createClient(bearer)
    const { data: claims } = await supabase.auth.getClaims(bearer)
    const userId = claims?.claims?.sub as string | undefined
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = (await req.json()) as ToolRequest
    const tool = body.tool
    const input = String(body.input || '').trim()
    const file = body.file

    if (!tool) return NextResponse.json({ error: 'Missing tool' }, { status: 400 })

    if (tool === 'calendar') {
      return NextResponse.json({ output: 'Open Tasks & Calendar to manage dated JARVIS tasks.' })
    }

    if (tool === 'calculator') {
      return NextResponse.json({ error: 'Calculator runs locally in the browser.' }, { status: 400 })
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const model = process.env.OPENAI_MODEL || 'gpt-5.6'

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY is not configured on the server.' }, { status: 500 })
    }

    let userContent: any[] = []

    if (input) {
      userContent.push({
        type: 'input_text',
        text: input
      })
    }

    if (file?.text) {
      userContent.push({
        type: 'input_text',
        text: 'File: ' + file.name + '\\n\\n' + file.text
      })
    }

    if (file?.imageData) {
      userContent.push({
        type: 'input_text',
        text: 'Analyze the attached image file named ' + file.name + '.'
      })
      userContent.push({
        type: 'input_image',
        image_url: file.imageData
      })
    }

    if (!userContent.length) {
      return NextResponse.json({ error: 'Provide text or a supported file.' }, { status: 400 })
    }

    const instructions: Record<string, string> = {
      search: 'You are JARVIS Web Search. Answer the request using web search. Prefer current, primary, and reliable sources. Clearly distinguish retrieved facts from uncertainty.',
      summarize: 'You are JARVIS Summarize. Produce an accurate concise summary. Preserve important facts, numbers, names, and caveats. Do not invent missing information.',
      translate: 'You are JARVIS Translate. Translate the supplied text faithfully. Preserve meaning, formatting where practical, and names. If the target language is unclear, state that it is unclear instead of guessing.',
      analyze: 'You are JARVIS Analyze. Analyze the supplied text or image directly. Describe what is actually present, distinguish observations from inference, and do not invent details.'
    }

    if (!instructions[tool]) {
      return NextResponse.json({ error: 'Unknown tool.' }, { status: 400 })
    }

    const response = await client.responses.create({
      model,
      instructions: instructions[tool],
      input: [{ role: 'user', content: userContent }],
      ...(tool === 'search' ? { tools: [{ type: 'web_search' as const }] } : {})
    } as any)

    return NextResponse.json({
      output: response.output_text || 'No result.'
    })
  } catch (e: any) {
    console.error(e)
    return NextResponse.json(
      { error: e?.message || 'Tool failed.' },
      { status: 500 }
    )
  }
}
