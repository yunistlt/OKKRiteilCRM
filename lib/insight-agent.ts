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
    recommendations?: string[];
    dialogue_count?: number;
    dialogue_summary?: string;
    last_contact_date?: string;
    last_order_changes?: string;
    customer_profile?: {
        total_orders?: number;
        client_resume?: string;
        perspective?: string;
        cross_sell?: string[];
    };
    summary: string;
    last_processed_event_id?: string;
}

/**
 * Runs deep analysis on an order to extract structured business insights.
 */
export async function runInsightAnalysis(orderId: number): Promise<BusinessInsights | null> {
    const { logAgentActivity } = await import('./agent-logger');
    await logAgentActivity('anna', 'working', `Изучаю детали заказа #${orderId}...`);

    try {
        // 1. Collect Evidence
        const { data: metrics } = await supabase
            .from('order_metrics')
            .select('*')
            .eq('retailcrm_order_id', orderId)
            .single();

        if (!metrics) {
            await logAgentActivity('anna', 'idle', 'Ожидаю данные для анализа');
            return null; // Changed from { success: false, error: 'Metrics not found' } to null to match original return type
        }

        const order = metrics.full_order_context || {}; // Renamed to 'order' to match original variable name
        // const managerId = metrics.manager_id; // Not used in the original function, so commented out
        const currentStatus = metrics.current_status;

        // 2. Fetch stage-specific metrics
        const { collectStageEvidence } = await import('./stage-collector');
        const evidence = await collectStageEvidence(orderId, currentStatus, metrics.computed_at || new Date().toISOString());

        // 3. Prepare Prompt
        const systemPrompt = `
You are a Senior Business Analyst and Sales Support Agent. Your task is to extract deep structured insights from CRM order data and interaction history.

STRICT BUSINESS RULES FOR ANALYSIS:
1. TARGET SEGMENT: We ONLY work with Corporate Clients (B2B). If the client is a physical person ("fiz-lico" or Individual), label the deal as "Non-target segment" and recommend closing or deprioritizing.
2. ZOMBIE DETECTION: If there are > 5 contact date shifts ("contact_date_shifts") without progress, or "days_since_last_interaction" > 30 for non-corporate clients, flag it as "Zombie/Imitation".
3. TENDER POLICY: If the status is "Waiting for Tender" and a Quote (KP) was already sent, the priority is LOW/PASSIVE. Do not recommend urgent calls unless a specific deadline is mentioned.
4. HIGH VALUE B2B: If "totalsumm" > 1M and it's a Corporate client, it's a HIGH PRIORITY deal. Even if it's "On Hold" (otlozeno), look for signs of "shipping" or "VAT adjustments". If it was shipped, the goal is "Document closing".
5. DATA HYGIENE: Check for missing Email. If missing, recommend obtaining it.

OUTPUT FORMAT (JSON):
{
  "lpr": { "name": "...", "role": "...", "influence": "decider|influencer|technical" },
  "budget": { "amount": "...", "status": "confirmed|estimated|negotiating", "constraints": "..." },
  "timeline": { "expected_delivery": "...", "urgency": "hot|normal|low", "deadlines": "..." },
  "pain_points": ["point 1", "point 2"],
  "competitors": ["name 1", "name 2"],
  "technical_requirements": ["req 1", "req 2"],
  "recommendations": ["Actionable advice 1 in Russian", "Actionable advice 2 in Russian"],
  "dialogue_count": number,
  "dialogue_summary": "Summary of all conversations in Russian",
  "last_contact_date": "ISO timestamp of last call",
  "last_order_changes": "Russian description of most recent meaningful order field changes",
  "customer_profile": {
    "total_orders": number,
    "client_resume": "1-2 sentences about who the client is, including company info if INN is present",
    "perspective": "Russian evaluation of how promising this client is long-term",
    "cross_sell": ["product/service 1", "product/service 2"]
  },
  "summary": "Short 1-2 sentence business summary in Russian"
}

Be precise and skeptical. Use the provided METRICS to validate manager claims.
`;

        const userPrompt = `
ORDER DATA:
${JSON.stringify(order.raw_payload, null, 2)}

INTERACTION HISTORY:
${JSON.stringify(evidence.interactions, null, 2)}

KEY METRICS:
- Contact Date Shifts: ${evidence.metrics?.contact_date_shifts}
- Days since last interaction: ${evidence.metrics?.days_since_last_interaction}
- Is Corporate Client: ${evidence.metrics?.is_corporate}
- Has Email: ${evidence.metrics?.has_email}
- Comments suggest shipped: ${evidence.metrics?.was_shipped_hint}
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

        // Ensure total_orders is set from evidence if AI missed it
        if (evidence.customerOrdersCount !== undefined && (!insights.customer_profile || insights.customer_profile.total_orders === undefined)) {
            if (!insights.customer_profile) insights.customer_profile = {};
            insights.customer_profile.total_orders = evidence.customerOrdersCount;
        }

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

        await logAgentActivity('anna', 'idle', 'Анализ завершен, инсайты добавлены в карточку.');

        return insights;

    } catch (error) {
        console.error(`[InsightAgent] Error for order ${orderId}:`, error);
        return null;
    }
}
