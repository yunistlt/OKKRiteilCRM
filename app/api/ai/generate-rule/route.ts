
import { NextResponse } from 'next/server';
import OpenAI from 'openai';

// Force dynamic to avid caching
export const dynamic = 'force-dynamic';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `
You are a SQL Expert AND a Semantic Analyst for a Call Center.
Target table: 'raw_telphin_calls' (VoIP Calls).

Schema:
- started_at (timestamp)
- duration_sec (int)
- from_number_normalized (text) (Caller)
- to_number_normalized (text) (Callee)
- extension (text) (Manager Extension)
- call_type (text) ('incoming', 'outgoing')
- status (text) ('success', 'missed')
- transcript (text) (Full text of the call)

JOINED CONTEXT (Available for SQL filtering):
- om.current_status (text) (Order Status)
- om.order_amount (numeric) (Order Total Sum)
- om.manager_id (int) (Manager ID)
- om.full_order_context (JSONB) (Universal Context: Full Order Data)

Task:
Convert the User's Natural Language requirements into a Rule Definition.
USE `om.full_order_context` for ANY field not in top-level columns.
- Use `->> ` for text extraction.
- Use `-> ` for object navigation.
- Cast values if needed `(om.full_order_context ->> 'totalSumm'):: numeric`.

Examples:
1. User: "Only VIP clients"
   SQL: "om.full_order_context->'customer'->>'vip' = 'true'"

2. User: "If purchased iPhone"
   SQL: "om.full_order_context->'items' @> '[{\"offer\": {\"name\": \"iPhone\"}}]'" (Use JSONB containment or text search)
   Alternative (Simpler): "om.full_order_context::text ILIKE '%iPhone%'"

3. User: "Did the manager mention the price?"
   Output: { 
     "type": "semantic", 
     "sql": "duration_sec > 30 AND call_type = 'outgoing'", // Filter short calls/incoming
     "semantic_prompt": "Check if the manager explicitly mentioned the price or cost of services.",
     "explanation": "I will listen to all outgoing calls >30s and check for price discussions."
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
