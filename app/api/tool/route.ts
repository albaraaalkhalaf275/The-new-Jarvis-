import OpenAI from 'openai'
import { NextResponse } from 'next/server'
export async function POST(req:Request){
 try{
  const {tool,input}=await req.json()
  if(!tool)return NextResponse.json({error:'Missing tool'},{status:400})
  if(tool==='calendar')return NextResponse.json({output:'Open Tasks to manage your JARVIS schedule.'})
  const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY}),model=process.env.OPENAI_MODEL||'gpt-5.6'
  const prompts:any={
   search:'Search the web for the request below. Give a concise factual answer and cite useful sources when available.\n'+input,
   summarize:'Summarize this material accurately and preserve important facts.\n'+input,
   translate:'Translate the following text according to the requested target language.\n'+input,
   analyze:'Analyze the supplied material. Do not invent information that was not supplied.\n'+input
  }
  const response=await client.responses.create({model,instructions:'You are a focused tool inside JARVIS. Be precise and honest about what you accessed.',input:prompts[tool]||input,...(tool==='search'?{tools:[{type:'web_search'}]}:{})} as any)
  return NextResponse.json({output:response.output_text||'No result.'})
 }catch(e:any){console.error(e);return NextResponse.json({error:e?.message||'Tool failed'},{status:500})}
}