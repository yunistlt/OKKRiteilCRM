
import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { supabase } from '@/utils/supabase';

// Force dynamic to avid caching
export const dynamic = 'force-dynamic';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt required' }, { status: 400 });
    }

    // 1. Fetch CRM Metadata to ground the AI
    const [statusesRes, managersRes] = await Promise.all([
      supabase.from('statuses').select('code, name').eq('is_working', true).eq('is_active', true),
      supabase.from('managers').select('first_name, last_name')
    ]);

    const statuses = statusesRes.data || [];
    const managers = managersRes.data || [];

    const SYSTEM_PROMPT = `
You are an OKK Rule Architect. Your task is to convert human requirements into structured Logic Blocks for RetailCRM.
Return your response in JSON format.
You use a library of predefined "Blocks".

CRITICAL: Ground your logic in these REAL RetailCRM status codes:
${statuses.map(s => `- ${s.name}: "${s.code}"`).join('\n')}

MANAGERS available: ${managers.map(m => `${m.first_name} ${m.last_name}`).join(', ')}

LIBRARY OF BLOCKS:

1. TRIGGER: 'status_change'
   - Description: Fires when order status changes OR checks current status for order-based rules.
   - Params: { "target_status": "code", "direction": "to" | "from" }

2. CONDITION: 'field_empty'
   - Description: Checks for missing comment or data.
   - Params: { "field_path": "manager_comment" | "next_contact_date" | "custom_field_code" }

3. CONDITION: 'time_elapsed'
   - Description: Checks if order/event is older than X hours.
   - Params: { "hours": number }

4. CONDITION: 'semantic_check'
   - Description: GPT-based semantic analysis of comments/transcripts.
   - Params: { "prompt": "instructions for AI" }

OUTPUT STRUCTURE:
{
  "name": "Название правила (RU)",
  "description": "Описание (RU)",
  "entity_type": "order" | "call" | "event",
  "rule_type": "sql" | "semantic",
  "logic": {
    "trigger": { "block": "status_change", "params": { "target_status": "...", "direction": "to" } },
    "conditions": [
      { "block": "time_elapsed", "params": { "hours": 24 } }
    ]
  }
}

NOTE: Use 'entity_type': 'order' for rules like "stale order" (checking how long it stays in status).
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const content = completion.choices[0].message.content;
    if (!content) throw new Error('No content');

    const result = JSON.parse(content);
    return NextResponse.json(result);

  } catch (e: any) {
    console.error('AI Rule Gen Error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
