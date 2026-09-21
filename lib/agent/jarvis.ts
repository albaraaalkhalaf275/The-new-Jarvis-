import { Agent, run, tool, webSearchTool } from '@openai/agents'
import { z } from 'zod'
import { safeCalculate } from '../calculator'

type JarvisContext = {
  supabase: any
  userId: string
  memoryOn: boolean
  memories: Array<{ id: string; memory: string }>
}

function safeCalculate(expression: string) {
  const cleaned = expression.replace(/,/g, '').trim()
  if (!/^[0-9+\-*/().%\s]+$/.test(cleaned)) {
    throw new Error('Only basic arithmetic is supported.')
  }

  const value = Function('"use strict"; return (' + cleaned + ')')()
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Invalid calculation.')
  }

  return String(value)
}

function buildInstructions(memories: JarvisContext['memories'], memoryOn: boolean) {
  const memoryContext = memoryOn
    ? (memories.map(x => `- [${x.id}] ${x.memory}`).join('\n') || 'No saved memories.')
    : 'Memory is disabled for this chat.'

  return `You are JARVIS, a capable personal AI agent.

Your job is to help the user accomplish tasks, not merely answer questions.
Be precise, direct, useful, and honest.
You have tools. Use them whenever they materially improve the result.
Never claim an action happened unless the corresponding tool actually completed it.
Use calculator for arithmetic instead of doing complex arithmetic mentally.
Use web search for current, changing, or externally verified information.
Use memory tools when the user asks you to remember, search, or forget something, or when a durable non-sensitive preference is clearly useful.
Do not save sensitive information unless the user explicitly asks you to remember it.
Ask for confirmation before destructive or externally consequential actions when a future tool supports them.
If a tool fails, explain the failure instead of pretending it succeeded.

Current saved memories:
${memoryContext}`
}

function makeTools(context: JarvisContext) {
  const calculator = tool({
    name: 'calculator',
    description: 'Calculate a basic arithmetic expression accurately.',
    parameters: z.object({
      expression: z.string().describe('Arithmetic expression using numbers and + - * / % parentheses.')
    }),
    async execute({ expression }) {
      return safeCalculate(expression)
    }
  })

  const saveMemory = tool({
    name: 'save_memory',
    description: 'Save a durable, non-sensitive user fact or preference for future conversations.',
    parameters: z.object({
      memory: z.string().min(1).describe('Short factual memory to save.')
    }),
    async execute({ memory }) {
      if (!context.memoryOn) return 'Memory is disabled, so nothing was saved.'

      const { data, error } = await context.supabase
        .from('memories')
        .insert({ user_id: context.userId, memory: memory.trim() })
        .select('id,memory')
        .single()

      if (error) throw error
      context.memories.unshift(data)
      return JSON.stringify({ saved: true, memory: data })
    }
  })

  const searchMemory = tool({
    name: 'search_memory',
    description: 'Search the user saved memories for relevant information.',
    parameters: z.object({
      query: z.string().min(1).describe('What to look for in saved memories.')
    }),
    async execute({ query }) {
      if (!context.memoryOn) return 'Memory is disabled for this chat.'

      const normalized = query.toLowerCase()
      const matches = context.memories.filter(item =>
        item.memory.toLowerCase().includes(normalized)
      )

      return JSON.stringify(matches.slice(0, 10))
    }
  })

  const forgetMemory = tool({
    name: 'forget_memory',
    description: 'Delete a saved memory when the user explicitly asks JARVIS to forget it.',
    parameters: z.object({
      memory_id: z.string().min(1).describe('ID of the memory to delete.')
    }),
    async execute({ memory_id }) {
      if (!context.memoryOn) return 'Memory is disabled for this chat.'

      const { error } = await context.supabase
        .from('memories')
        .delete()
        .eq('id', memory_id)
        .eq('user_id', context.userId)

      if (error) throw error

      context.memories = context.memories.filter(item => item.id !== memory_id)
      return JSON.stringify({ deleted: true, memory_id })
    }
  })

  return [
    webSearchTool({ searchContextSize: 'medium' }),
    calculator,
    saveMemory,
    searchMemory,
    forgetMemory
  ]
}

export async function runJarvisAgent({
  message,
  history,
  memories,
  supabase,
  userId,
  memoryOn
}: {
  message: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  memories: Array<{ id: string; memory: string }>
  supabase: any
  userId: string
  memoryOn: boolean
}) {
  const context: JarvisContext = {
    supabase,
    userId,
    memoryOn,
    memories: [...memories]
  }

  const agent = new Agent({
    name: 'JARVIS',
    // Let the Agents SDK use its current default model (gpt-5.6-luna).
    instructions: buildInstructions(context.memories, context.memoryOn),
    tools: makeTools(context)
  })

  const input = [
    ...history.map(item => ({
      role: item.role,
      content: item.content
    })),
    { role: 'user' as const, content: message }
  ]

  const result = await run(agent, input)

  return {
    answer: result.finalOutput || 'I could not generate a response.'
  }
}
