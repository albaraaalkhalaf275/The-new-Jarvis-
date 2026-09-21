import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { getClientIp, rateLimit, rejectIfTooLarge, safeError, secureJson, validateRequestOrigin } from '../../../lib/security'
import { z } from 'zod'

const ToolSchema = z.object({
  tool: z.enum(['search', 'summarize', 'translate', 'analyze', 'calendar', 'calculator']),
  input: z.string().trim().max(20_000).optional(),
  file: z.object({
    name: z.string().min(1).max(255),
    type: z.string().max(100),
    text: z.string().max(120_000).optional(),
    imageData: z.string().max(8_000_000).optional(),
    size: z.number().int().nonnegative().max(8_000_000).optional()
  }).strict().optional()
}).strict()

const ALLOWED_TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'html', 'css', 'js', 'jsx', 'ts', 'tsx'])
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_BODY_BYTES = 9 * 1024 * 1024

function extension(name: string) {
  const value = name.toLowerCase().split('.').pop() || ''
  return value
}

function validateFile(file: z.infer<typeof ToolSchema>['file']) {
  if (!file) return null
  const ext = extension(file.name)
  const image = ALLOWED_IMAGE_TYPES.has(file.type)
  const text = ALLOWED_TEXT_EXTENSIONS.has(ext)
  if (!image && !text) return 'Unsupported file type.'
  if (image && !file.imageData) return 'Image data is missing.'
  if (text && !file.text) return 'Text file content is missing.'
  if (file.size && file.size > 8_000_000) return 'File is too large.'
  if (file.text && file.text.length > 120_000) return 'Text file is too large.'
  if (file.imageData && file.imageData.length > 8_000_000) return 'Image is too large.'
  if (image && !file.imageData!.startsWith(`data:${file.type};base64,`)) return 'Invalid image data.'
  return null
}

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
    const limit = rateLimit(`tool:${userId}:${ip}`, 'tool')
    if (!limit.allowed) {
      const response = secureJson({ error: 'Too many tool requests. Please wait.' }, { status: 429 })
      response.headers.set('Retry-After', String(limit.retryAfter))
      return response
    }

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return secureJson({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    const parsed = ToolSchema.safeParse(raw)
    if (!parsed.success) return secureJson({ error: 'Invalid tool request.' }, { status: 400 })

    const { tool, input = '', file } = parsed.data
    const fileError = validateFile(file)
    if (fileError) return secureJson({ error: fileError }, { status: 400 })

    if (tool === 'calendar') return secureJson({ output: 'Open Tasks & Calendar to manage dated JARVIS tasks.' })
    if (tool === 'calculator') return secureJson({ error: 'Calculator runs locally in the browser.' }, { status: 400 })

    if (!process.env.OPENAI_API_KEY) {
      return secureJson({ error: 'JARVIS is not configured yet.' }, { status: 503 })
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const model = process.env.OPENAI_MODEL || 'gpt-5.6-luna'

    const userContent: any[] = []
    if (input) userContent.push({ type: 'input_text', text: input })
    if (file?.text) userContent.push({ type: 'input_text', text: 'File content:\n' + file.text })
    if (file?.imageData) {
      userContent.push({ type: 'input_text', text: 'Analyze the attached image file named ' + file.name + '.' })
      userContent.push({ type: 'input_image', image_url: file.imageData })
    }
    if (!userContent.length) return secureJson({ error: 'Provide text or a supported file.' }, { status: 400 })

    const instructions: Record<string, string> = {
      search: 'You are JARVIS Web Search. Answer using web search. Prefer current, primary, and reliable sources. Clearly distinguish retrieved facts from uncertainty.',
      summarize: 'You are JARVIS Summarize. Produce an accurate concise summary. Preserve important facts, numbers, names, and caveats. Do not invent missing information.',
      translate: 'You are JARVIS Translate. Translate the supplied text faithfully. Preserve meaning, formatting where practical, and names. If the target language is unclear, state that it is unclear instead of guessing.',
      analyze: 'You are JARVIS Analyze. Analyze the supplied text or image directly. Describe what is actually present, distinguish observations from inference, and do not invent details.'
    }

    const response = await client.responses.create({
      model,
      instructions: instructions[tool],
      input: [{ role: 'user', content: userContent }],
      ...(tool === 'search' ? { tools: [{ type: 'web_search' as const }] } : {})
    } as any)

    return secureJson({
      output: String(response.output_text || 'No result.').slice(0, 30_000)
    })
  } catch (e: any) {
    console.error('JARVIS tool error:', e)
    return secureJson({ error: safeError(e) }, { status: 500 })
  }
}
