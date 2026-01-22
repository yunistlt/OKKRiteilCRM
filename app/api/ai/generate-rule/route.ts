
import { NextResponse } from 'next/server';
import OpenAI from 'openai';

// Force dynamic to avid caching
export const dynamic = 'force-dynamic';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `
You are an OKK Rule Architect. Your task is to convert human requirements into structured Logic Blocks.
You do NOT write SQL code anymore. You use a library of predefined "Blocks".

LIBRARY OF BLOCKS (Managed in 'okk_block_definitions'):

1. TRIGGER: 'status_change'
   - Description: Fires when order status changes.
   - Params: { "target_status": "code", "direction": "to" | "from" }

2. CONDITION: 'field_empty'
   - Description: Checks for missing comment or data.
   - Params: { "field_path": "manager_comment" | "next_contact_date" | "custom_field_code" }

3. CONDITION: 'time_elapsed'
   - Description: Checks if event is older than X hours.
   - Params: { "hours": number }

4. CONDITION: 'call_exists'
   - Description: Checks for a call in history.
   - Params: { "window_hours": number, "min_duration": number }

5. CONDITION: 'semantic_check'
   - Description: GPT-based semantic analysis.
   - Params: { "prompt": "instructions for AI" }

OUTPUT STRUCTURE:
You must return a JSON object representing the rule. Rules are evaluated as: TRIGGER -> [List of CONDITIONS (AND logic)].

{
  "name": "Название правила (RU)",
  "description": "Описание (RU)",
  "entity_type": "event" | "call",
  "rule_type": "sql" | "semantic",
  "logic": {
    "trigger": { "block": "status_change", "params": { ... } },
    "conditions": [
      { "block": "block_code", "params": { ... } }
    ]
  }
}

EXAMPLES:
User: "If status is Cancel and no comment"
Output: {
  "name": "Отмена без комментария",
  "entity_type": "event",
  "rule_type": "sql",
  "logic": {
    "trigger": { "block": "status_change", "params": { "target_status": "cancel", "direction": "to" } },
    "conditions": [{ "block": "field_empty", "params": { "field_path": "manager_comment" } }]
  }
}

User: "Check if manager was polite in the call"
Output: {
  "name": "Вежливость менеджера",
  "entity_type": "call",
  "rule_type": "semantic",
  "logic": {
    "trigger": null,
    "conditions": [{ "block": "semantic_check", "params": { "prompt": "Оцени вежливость..." } }]
  }
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
