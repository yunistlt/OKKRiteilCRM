// ОТВЕТСТВЕННЫЙ: АННА (Бизнес-аналитик) — Глубокий анализ сделок, поиск ЛПР и инсайтов.
import { supabase } from '@/utils/supabase';
import OpenAI from 'openai';
import { logAgentActivity } from './agent-logger';
import { collectStageEvidence } from './stage-collector';
import { generateEmbedding, formatExampleForEmbedding } from './embeddings';
import { ANNA_INSIGHT_PROMPT } from './prompts';

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

        // 2. Fetch history (Full history for better context)
        const entryTime = order.createdAt || '2020-01-01T00:00:00Z';
        const evidence = await collectStageEvidence(orderId, currentStatus, entryTime);

        // 3. Prepare RAG (Historical Knowledge)
        let historicalKnowledge = "";
        try {
            // We use the interaction summary and current order for finding similar cases
            const searchContext = {
                order_number: order.number,
                status: currentStatus,
                comments: order.managerComment || ""
            };
            const queryEmbedding = await generateEmbedding(formatExampleForEmbedding("", searchContext));
            
            const { data: matches, error: matchError } = await supabase.rpc('match_training_examples', {
                query_embedding: queryEmbedding,
                match_threshold: 0.5, // Broad search to find anything relevant
                match_count: 3
            });

            if (!matchError && matches && matches.length > 0) {
                historicalKnowledge = "\nПОДОБНЫЕ СИТУАЦИИ ИЗ ТВОЕГО ОПЫТА (ДЛЯ ИНТУИЦИИ):\n" + 
                    matches.map((m: any, i: number) => {
                        return `${i+1}. Заказ #${m.order_number}: [Статус: ${m.order_context?.target_status || m.traffic_light}]
   Обоснование: ${m.user_reasoning}`;
                    }).join('\n\n') + "\n\nИспользуй этот опыт для уточнения своих рекомендаций.";
            }
        } catch (e) {
            console.warn('[InsightAgent] RAG retrieval failed:', e);
        }

        // 4. Prepare Prompt
        const systemPrompt = ANNA_INSIGHT_PROMPT.replace('{{historicalKnowledge}}', historicalKnowledge);

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
