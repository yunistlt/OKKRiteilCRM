import { supabase } from '@/utils/supabase';
import OpenAI from 'openai';

let _openai: OpenAI | null = null;
function getOpenAI() {
    if (!_openai) {
        if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
        _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return _openai;
}

export interface BusinessInsights {
    lpr?: {
        name?: string;
        role?: string;
        influence?: 'decider' | 'influencer' | 'technical';
    };
    budget?: {
        amount?: string;
        status?: 'confirmed' | 'estimated' | 'negotiating';
        constraints?: string;
    };
    timeline?: {
        expected_delivery?: string;
        urgency?: 'hot' | 'normal' | 'low';
        deadlines?: string;
    };
    pain_points?: string[];
    competitors?: string[];
    technical_requirements?: string[];
    summary: string;
    last_processed_event_id?: string;
}

/**
 * Runs deep analysis on an order to extract structured business insights.
 */
export async function runInsightAnalysis(orderId: number): Promise<BusinessInsights | null> {
    try {
        // 1. Fetch Order Data (Everything)
        const { data: order } = await supabase
            .from('orders')
            .select('*')
            .eq('order_id', orderId)
            .single();

        if (!order) return null;

        // 2. Fetch All Interactions (Calls + History)
        const { collectStageEvidence } = await import('./stage-collector');
        // We collect from the very beginning of the order (0 entry time)
        const evidence = await collectStageEvidence(orderId, order.status, '2000-01-01T00:00:00Z');

        // 3. Prepare Prompt
        const systemPrompt = `
You are a Senior Business Analyst. Your task is to extract deep structured insights from a CRM order data and interaction history.
Look beyond simple fields - identify the LPR (Decision Maker), their true pain points, budget status, and technical requirements.

OUTPUT FORMAT (JSON):
{
  "lpr": { "name": "...", "role": "...", "influence": "decider|influencer|technical" },
  "budget": { "amount": "...", "status": "confirmed|estimated|negotiating", "constraints": "..." },
  "timeline": { "expected_delivery": "...", "urgency": "hot|normal|low", "deadlines": "..." },
  "pain_points": ["point 1", "point 2"],
  "competitors": ["name 1", "name 2"],
  "technical_requirements": ["req 1", "req 2"],
  "summary": "Short 1-2 sentence business summary in Russian"
}

If information is missing, omit the field or set to null.
Be precise and use evidence from transcripts and manager comments.
`;

        const userPrompt = `
ORDER DATA:
${JSON.stringify(order.raw_payload, null, 2)}

INTERACTION HISTORY:
${JSON.stringify(evidence.interactions, null, 2)}
`;

        const openai = getOpenAI();
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            response_format: { type: "json_object" },
            temperature: 0.1,
        });

        const content = completion.choices[0].message.content;
        if (!content) return null;

        const insights = JSON.parse(content) as BusinessInsights;

        // 4. Save to Database
        await supabase
            .from('order_metrics')
            .upsert({
                retailcrm_order_id: orderId,
                insights: insights,
                computed_at: new Date().toISOString()
            }, { onConflict: 'retailcrm_order_id' });

        // 5. Update last run in sync_state
        await supabase
            .from('sync_state')
            .upsert({
                key: 'insight_agent_last_run',
                value: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, { onConflict: 'key' });

        return insights;

    } catch (error) {
        console.error(`[InsightAgent] Error for order ${orderId}:`, error);
        return null;
    }
}
