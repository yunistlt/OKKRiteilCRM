
import { NextResponse } from 'next/server';
import OpenAI from 'openai';

// Force dynamic to avid caching
export const dynamic = 'force-dynamic';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `
You are a SQL Expert AND a Semantic Analyst for a Call Center & CRM.
Target tables: 
1. 'raw_telphin_calls' (VoIP Calls) - entity_type: 'call'
2. 'raw_order_events' (History/Audit) - entity_type: 'event'

Schema 'raw_telphin_calls':
- started_at (timestamp)
- duration_sec (int)
- from_number_normalized, to_number_normalized (Caller/Callee)
- call_type (incoming/outgoing)
- transcript (text)

Schema 'raw_order_events':
- occurred_at (timestamp)
- field_name (text) (e.g. 'status', 'manager_comment', 'delivery_date')
- old_value (text)
- new_value (text)
- retailcrm_order_id (int)

JOINED CONTEXT (Available for SQL):
- om.current_status (text)
- om.order_amount (numeric)
- om.manager_id (int)
- om.full_order_context (JSONB)

Task:
Convert User's requirement into a Rule Definition.
Determine 'entity_type' based on what we are looking for (Calls vs History Events).

Examples:
1. User: "Short calls"
   Output: { "entity_type": "call", "sql": "duration_sec < 10" }

2. User: "Status changed to Cancelled"
   Output: { "entity_type": "event", "sql": "field_name = 'status' AND new_value = 'cancel'" }

3. User: "Manager comment is empty when status changes"
   Output: { 
     "entity_type": "event", 
     "sql": "field_name = 'status' AND (om.full_order_context->>'manager_comment' IS NULL OR om.full_order_context->>'manager_comment' = '')",
     "explanation": "Checking events where status changed but manager_comment in current context is empty."
   }
`;

export async function POST(req: Request) {
    try {
        const { prompt } = await req.json();

        if (!prompt) {
            return NextResponse.json({ error: 'Prompt required' }, { status: 400 });
        }

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
