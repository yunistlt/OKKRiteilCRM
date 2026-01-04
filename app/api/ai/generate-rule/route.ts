
import { NextResponse } from 'next/server';
import OpenAI from 'openai';

// Force dynamic to avid caching
export const dynamic = 'force-dynamic';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `
You are a SQL Expert for a PostgreSQL database.
Your target table is 'raw_telphin_calls' (VoIP Calls).

Schema:
- telphin_call_id (bigint)
- started_at (timestamp)
- duration_sec (int) - Duration of the call in seconds
- from_number_normalized (text) - Caller phone (E.164)
- to_number_normalized (text) - Callee phone (E.164)
- extension (text) - Employee Extension
- call_type (text) - 'incoming', 'outgoing'
- status (text) - 'success', 'missed', 'cancelled'

Task:
Convert the User's Natural Language requirements into a valid SQL WHERE clause fragment.
Do not include "WHERE". Do not include "SELECT * FROM ...".
Only return the condition.

Example 1:
User: "Calls shorter than 10 seconds"
Output: duration_sec < 10

Example 2:
User: "Missed incoming calls"
Output: status = 'missed' AND call_type = 'incoming'

Example 3:
User: "Calls from 7999..."
Output: from_number_normalized LIKE '7999%'

Return simplified JSON: { "sql": "string", "explanation": "string" }
`;

export async function POST(req: Request) {
    try {
        const { prompt } = await req.json();

        if (!prompt) {
            return NextResponse.json({ error: 'Prompt required' }, { status: 400 });
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4-turbo-preview", // Or gpt-3.5-turbo if cost concern, but 4 is safer for SQL
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" },
            temperature: 0.2, // Deterministic
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
