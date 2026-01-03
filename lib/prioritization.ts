import { supabase } from '@/utils/supabase';
import { getOpenAIClient } from '../utils/openai';

export type PriorityLevel = 'red' | 'yellow' | 'green' | 'black';

export interface OrderPriority {
    orderId: number;
    orderNumber: string;
    managerId: number;
    managerName: string;
    level: PriorityLevel;
    score: number; // 0-100, where 100 is most critical
    reasons: string[];
    summary: string; // AI generated summary of WHY it is critical
    recommendedAction?: string;
    lastActionAt: string;
    totalSum: number;
}

// Rules for heuristic pre-filtering
const CRITICAL_SLA_HOURS = 4; // Hours in 'new' without action
const STAGNATION_DAYS = 7; // Days without any update

export async function calculatePriorities(limit: number = 2000): Promise<OrderPriority[]> {
    // 0. Fetch Managers Map
    const { data: managersRaw } = await supabase.from('managers').select('id, first_name, last_name');
    const managerNames: Record<number, string> = {};
    (managersRaw || []).forEach(m => {
        managerNames[m.id] = `${m.first_name || ''} ${m.last_name || ''}`.trim();
    });

    // 0. Fetch System Prompt
    const { data: promptData } = await supabase
        .from('system_prompts')
        .select('content')
        .eq('key', 'order_analysis_main')
        .single();
    const aiPromptTemplate = promptData?.content;

    // 1. Fetch Active Working Orders
    const { data: workingSettings } = await supabase.from('status_settings').select('code').eq('is_working', true);
    const workingCodes = (workingSettings || []).map(s => s.code);
    console.log('Working Codes:', workingCodes.length, workingCodes[0]);

    if (!workingCodes.length) return [];

    // 2. Fetch Orders with those statuses (with pagination)
    let allOrders: any[] = [];
    let from = 0;
    const PAGE_SIZE = 1000;

    while (true) {
        const { data: batch, error } = await supabase
            .from('orders')
            .select(`
                id, number, status, created_at, updated_at, manager_id, totalsumm, raw_payload,
                matches (
                    calls (
                        id, timestamp, duration, transcript, am_detection_result
                    )
                )
            `)
            .in('status', workingCodes)
            .order('updated_at', { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

        if (error) {
            console.error('Prioritization Query Error (Batch):', error);
            // If partial data, continue? Or throw? 
            // Better to stop this batch but keep previous
            break;
        }

        if (!batch || batch.length === 0) break;

        allOrders = [...allOrders, ...batch];

        if (batch.length < PAGE_SIZE) break; // End of list
        from += PAGE_SIZE;

        // Safety break if infinite loop (e.g. limit > 10000 and we want to stop?)
        if (allOrders.length >= limit) break;
    }

    const orders = allOrders.slice(0, limit);
    console.log(`Fetched Total Orders: ${orders.length} (Requested Limit: ${limit})`);

    if (orders.length === 0) return [];

    const priorities: OrderPriority[] = [];
    const now = new Date();

    for (const order of orders) {
        const reasons: string[] = [];
        let score = 0;
        let level: PriorityLevel = 'black'; // Default to Black (Unknown/Neutral)

        // --- 1. Hard Rules (Heuristics) ---

        // Rule: Stagnation
        // Only classify as Red/Yellow if stagnation is significant.
        const daysSinceUpdate = (now.getTime() - new Date(order.updated_at).getTime()) / (1000 * 3600 * 24);
        if (daysSinceUpdate > STAGNATION_DAYS) {
            score += 40;
            reasons.push(`Заказ висит без движения ${Math.round(daysSinceUpdate)} дней`);
            level = daysSinceUpdate > 14 ? 'red' : 'yellow';
        }

        // Rule: New Status SLA
        if ((order.status.includes('new') || order.status.includes('novy')) && daysSinceUpdate * 24 > CRITICAL_SLA_HOURS) {
            score += 50;
            reasons.push('Превышен SLA для нового заказа (>4ч)');
            level = 'red';
        }

        // --- 2. AI Analysis (Sentiment & Context) ---
        // Flatten calls from matches
        const allCalls = (order.matches || [])
            .map((m: any) => m.calls)
            .filter((c: any) => c !== null);

        const lastCall = allCalls.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

        let aiSummary = "Ожидание анализа";

        if (lastCall && lastCall.transcript) {
            // Extract TOP-3 from raw_payload
            const payload = order.raw_payload as any || {};
            const customFields = payload.customFields || {};
            const top3 = {
                price: customFields.top3_prokhodim_li_po_tsene2 === 'yes' ? 'Да' : customFields.top3_prokhodim_li_po_tsene2 === 'no' ? 'Нет' : 'Не указано',
                timing: customFields.top3_prokhodim_po_srokam1 === 'yes' ? 'Да' : customFields.top3_prokhodim_po_srokam1 === 'no' ? 'Нет' : 'Не указано',
                specs: customFields.top3_prokhodim_po_tekh_kharakteristikam === 'yes' ? 'Да' : customFields.top3_prokhodim_po_tekh_kharakteristikam === 'no' ? 'Нет' : 'Не указано'
            };

            const aiResult = await analyzeOrderWithAI(
                lastCall.transcript,
                order.status,
                daysSinceUpdate,
                order.totalsumm || 0,
                aiPromptTemplate,
                top3
            );

            if (aiResult) {
                level = aiResult.traffic_light;
                aiSummary = aiResult.short_reason;
                reasons.push(`AI: ${aiResult.short_reason}`);
                score += level === 'red' ? 50 : (level === 'yellow' ? 20 : 0);
            }
        }

        // Fallback Green logic for all orders (if still black)
        if (level === 'black') {
            if (daysSinceUpdate < 3) {
                level = 'green';
                reasons.push('Недавняя активность (менее 3 дней)');
            }
        }

        const managerName = order.manager_id && managerNames[order.manager_id]
            ? managerNames[order.manager_id]
            : 'Unknown';

        priorities.push({
            orderId: order.id,
            orderNumber: order.number,
            managerId: order.manager_id,
            managerName,
            level,
            score: Math.min(score, 100),
            reasons,
            summary: aiSummary,
            recommendedAction: 'Проверить статус',
            lastActionAt: order.updated_at,
            totalSum: order.totalsumm || 0
        });
    } // End Loop

    // Return ALL (limit applied at end if needed, but route says 'all' for distribution?)
    // Route currently slices. We should slice only if requested. 
    // But we want to return counts for dashboard.
    // Dashboard probably needs aggregated counts + list of Top Critical.
    // I'll return ALL priorities here, so API can aggregate or slice.

    return priorities.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function getStoredPriorities(limit: number = 2000): Promise<OrderPriority[]> {
    // 1. Get working statuses first
    const { data: workingSettings } = await supabase.from('status_settings').select('code').eq('is_working', true);
    const workingCodes = (workingSettings || []).map(s => s.code);

    if (workingCodes.length === 0) return [];

    let allPriorities: any[] = [];
    let from = 0;
    const PAGE_SIZE = 1000;

    while (true) {
        const { data: batch, error } = await supabase
            .from('order_priorities')
            .select(`
                level, score, reasons, summary, recommended_action, updated_at,
                orders!inner (
                    id, number, manager_id, totalsumm, updated_at, status
                )
            `)
            .in('orders.status', workingCodes)
            .order('score', { ascending: false })
            .range(from, from + PAGE_SIZE - 1);

        if (error) {
            console.error('Stored Priorities Query Error:', error);
            break;
        }

        if (!batch || batch.length === 0) break;

        allPriorities = [...allPriorities, ...batch];

        if (batch.length < PAGE_SIZE) break;
        from += PAGE_SIZE;

        if (allPriorities.length >= limit) break;
    }

    const prioritiesRaw = allPriorities.slice(0, limit);



    // Need manager names
    const { data: managersRaw } = await supabase.from('managers').select('id, first_name, last_name');
    const managerNames: Record<number, string> = {};
    (managersRaw || []).forEach(m => {
        managerNames[m.id] = `${m.first_name || ''} ${m.last_name || ''}`.trim();
    });

    return (prioritiesRaw || []).map((p: any) => {
        const order = p.orders;
        const managerName = order?.manager_id && managerNames[order.manager_id]
            ? managerNames[order.manager_id]
            : 'Unknown';

        return {
            orderId: order?.id,
            orderNumber: order?.number,
            managerId: order?.manager_id,
            managerName,
            level: p.level,
            score: p.score,
            reasons: p.reasons || [],
            summary: p.summary,
            recommendedAction: p.recommended_action,
            lastActionAt: order?.updated_at, // Use order's update time for display? Or priority's? Usually order's.
            totalSum: order?.totalsumm || 0
        };
    }).filter(p => p.orderId); // Filter out orphans if any
}

// Default prompt if DB entry missing
const DEFAULT_PROMPT = `Роль ИИ
Ты — аналитик заказов в B2B-продажах. Твоя задача — выявить критически важные заказы.

📥 Входные данные:
- last_call_date: {{days}} дн. назад
- last_call_summary: {{transcript}}
- total_sum: {{sum}} руб.
- order_status: {{status}}

🚦 Правила Светофора:
1. 🔴 КРАСНЫЙ (Critical):
   - Клиент готов платить, но менеджер тормозит.
   - Клиент недоволен сроками/качеством.
   - Есть риск ухода к конкуренту.

2. 🟡 ЖЕЛТЫЙ (Warning):
   - Есть вопросы без ответов.
   - Сделка затянулась, но клиент на связи.

3. 🟢 ЗЕЛЕНЫЙ (OK):
   - Идет рабочий процесс.
   - Ждем поставку/производство (норма).
   - "Я подумаю" (не срочно).

💡 Вывод (JSON):
{
  "traffic_light": "red" | "yellow" | "green",
  "short_reason": "Краткая причина (макс 6 слов)",
  "recommended_action": "Что сделать менеджеру"
}`;

export async function analyzeOrderWithAI(
    transcript: string,
    status: string,
    daysStagnant: number,
    amount: number,
    promptTemplate?: string,
    top3?: { price: string; timing: string; specs: string }
): Promise<{
    traffic_light: 'red' | 'yellow' | 'green',
    short_reason: string,
    recommended_action: string
}> {
    const openai = getOpenAIClient();

    let prompt = promptTemplate || DEFAULT_PROMPT;

    // Fetch training examples for few-shot learning
    const { data: examples } = await supabase
        .from('training_examples')
        .select('*')
        .limit(6); // Get up to 6 examples (2 per color ideally)

    // Build few-shot examples section
    let fewShotSection = '';
    if (examples && examples.length > 0) {
        // Group by traffic light
        const redExamples = examples.filter(e => e.traffic_light === 'red').slice(0, 2);
        const yellowExamples = examples.filter(e => e.traffic_light === 'yellow').slice(0, 2);
        const greenExamples = examples.filter(e => e.traffic_light === 'green').slice(0, 2);

        fewShotSection = '\n\n📚 Примеры правильных оценок:\n\n';

        const formatExample = (ex: any, colorLabel: string) => {
            const ctx = ex.order_context || {};
            let str = `Пример (${colorLabel}):\n`;
            str += `- Транскрипт: "${(ctx.lastCall?.transcript || '').substring(0, 200)}..."\n`;
            str += `- Статус: ${ctx.status || 'N/A'}\n`;
            str += `- Дней без обновления: ${ctx.daysSinceUpdate || 0}\n`;
            if (ctx.top3) {
                str += `- ТОП-3 (Цена/Срок/Тех): ${ctx.top3.price}/${ctx.top3.timing}/${ctx.top3.specs}\n`;
            }
            str += `- Сумма: ${ctx.totalSum || 0} руб.\n`;
            str += `- Обоснование: "${ex.user_reasoning}"\n\n`;
            return str;
        };

        redExamples.forEach((ex) => { fewShotSection += formatExample(ex, '🔴 КРАСНЫЙ'); });
        yellowExamples.forEach((ex) => { fewShotSection += formatExample(ex, '🟡 ЖЕЛТЫЙ'); });
        greenExamples.forEach((ex) => { fewShotSection += formatExample(ex, '🟢 ЗЕЛЕНЫЙ'); });

        fewShotSection += 'Используй эти примеры для калибровки своей оценки.\n\n---\n\n';
    }

    // Prepare top3 string for the prompt
    const top3Str = top3
        ? `\n- TOP-3 Quality (Price/Timing/Tech): ${top3.price}/${top3.timing}/${top3.specs}`
        : '';

    // Replace placeholders and add few-shot examples
    prompt = prompt
        .replace('{{days}}', Math.round(daysStagnant).toString())
        .replace('{{transcript}}', transcript.substring(0, 3000))
        .replace('{{sum}}', amount.toString())
        .replace('{{status}}', `${status}${top3Str}`);

    // Insert few-shot examples before the output format section
    if (prompt.includes('💡 Вывод')) {
        prompt = prompt.replace('💡 Вывод', fewShotSection + '💡 Вывод');
    } else {
        prompt = fewShotSection + prompt;
    }

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.3
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("No AI response");

    return JSON.parse(content);
}
