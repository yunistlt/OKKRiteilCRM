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

        // 2. Fetch history (Full history for better context)
        const { collectStageEvidence } = await import('./stage-collector');
        const entryTime = order.createdAt || '2020-01-01T00:00:00Z';
        const evidence = await collectStageEvidence(orderId, currentStatus, entryTime);

        // 3. Prepare Prompt
        const systemPrompt = `
Ты — Старший Бизнес-аналитик (Анна). Твоя роль: стратегический анализ сделок и поиск точек роста.
Твоя задача: на основе сырых данных CRM и истории взаимодействий сформировать глубокие инсайты, которые помогут отделу продаж и системе маршрутизации.

ПРАВИЛА И ГЛУБИНА АНАЛИЗА:
1. ПРИЧИННО-СЛЕДСТВЕННАЯ СВЯЗЬ: Не просто констатируй факты, а ищи ПРИЧИНУ. 
   - Если клиент отказался из-за сроков — выясни, какой срок его не устроил и был ли у него дедлайн.
   - Если клиент ушел к конкуренту — найди в диалоге, ЧТО именно предложил конкурент (быстрее, дешевле, наличие на складе).
2. СТРАТЕГИЧЕСКИЙ ВЗГЛЯД (GROWTH POINTS): 
   - Ищи возможности для Cross-sell (сопутствующие товары).
   - Оценивай потенциал клиента (LPR, масштаб компании, регулярность закупок).
3. КРИТИЧЕСКОЕ МЫШЛЕНИЕ: Будь скептична. Если менеджер пишет «клиент думает», а в транскрипте звонка клиент сказал «дорого, закажу у других» — подсвети это противоречие.
4. ТЕРМИНОЛОГИЯ: Используй профессиональный бизнес-язык (ЛПР, КТРУ, ТЗ, оффер, дедлайн, логистическое плечо).

STRICT BUSINESS RULES:
- TARGET SEGMENT: B2B (Corporate). B2C ("fiz-lico") = Low priority.
- ZOMBIE DETECTION: >5 shifts of contact date or >30 days silence = Flag as Zombie.
- TENDER POLICY: Low priority if status is "Waiting for Tender" and Quote was sent, unless a specific deadline is imminent.

ФОРМАТ ВЫВОДА (JSON):
{
  "lpr": { "name": "ФИО", "role": "Должность", "influence": "decider|influencer|technical" },
  "budget": { "amount": "Сумма", "status": "confirmed|estimated|negotiating", "constraints": "Ограничения (напр. 'строго до 100к')" },
  "timeline": { "expected_delivery": "Когда нужно", "urgency": "hot|normal|low", "deadlines": "Конкретные даты" },
  "pain_points": ["Боли клиента (напр. 'нужно наличие в Москве')"],
  "competitors": ["Упомянутые конкуренты или причины выбора других"],
  "technical_requirements": ["ТЗ, спецификации, ГОСТы"],
  "recommendations": ["Конкретные стратегические советы для менеджера на РУССКОМ"],
  "dialogue_count": число,
  "dialogue_summary": "ПОДРОБНАЯ хронология и логика общения на РУССКОМ. Опиши развитие мысли клиента.",
  "last_contact_date": "ISO timestamp",
  "last_order_changes": "Описание последних значимых изменений в полях заказа",
  "customer_profile": {
    "total_orders": число,
    "client_resume": "Профессиональный портрет клиента (кто они, чем занимаются, ИНН)",
    "perspective": "Оценка перспективности работы с клиентом долгосрочно",
    "cross_sell": ["Что еще мы можем им продать"]
  },
  "summary": "Глубокое аналитическое резюме сделки (2-3 предложения). Почему мы выигрываем или проигрываем."
}

Пиши на грамотном русском языке. Твои рассуждения должны быть глубокими, как у опытного бизнес-консультанта.
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
