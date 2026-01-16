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

export async function calculatePriorities(limit: number = 2000, skipAI: boolean = false): Promise<OrderPriority[]> {
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
                call_order_matches (
                    raw_telphin_calls (
                        telphin_call_id, started_at, duration_sec, transcript
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

        // Safety break
        if (allOrders.length >= limit) break;
    }

    const orders = allOrders.slice(0, limit);
    console.log(`Fetched Total Orders: ${orders.length} (Requested Limit: ${limit})`);

    // [New] Batch fetch history logs for these orders to avoid N+1
    const orderIds = orders.map(o => o.id);
    let historyMap: Record<number, any[]> = {};
    if (orderIds.length > 0) {
        const { data: histories } = await supabase
            .from('order_history_log')
            .select('*')
            .in('retailcrm_order_id', orderIds)
            .order('occurred_at', { ascending: true }); // Oldest first for timeline

        (histories || []).forEach(h => {
            if (!historyMap[h.retailcrm_order_id]) historyMap[h.retailcrm_order_id] = [];
            historyMap[h.retailcrm_order_id].push(h);
        });
    }

    if (orders.length === 0) return [];

    const priorities: OrderPriority[] = [];
    const now = new Date();

    for (const order of orders) {
        const reasons: string[] = [];
        let score = 0;
        let level: PriorityLevel = 'black'; // Default to Black (Unknown/Neutral)

        // --- 1. Hard Rules (Heuristics) ---

        // Extract and flatten all calls
        const rawCalls = (order.call_order_matches || [])
            .map((m: any) => m.raw_telphin_calls)
            .filter((c: any) => c !== null)
            .map((c: any) => ({
                id: c.telphin_call_id,
                timestamp: c.started_at,
                duration: c.duration_sec,
                transcript: c.transcript,
            }));

        const allCalls = rawCalls;
        const lastCall = allCalls.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

        // Prepare Call Stats (Pattern)
        const totalCalls = allCalls.length;
        const shortCalls = allCalls.filter((c: any) => c.duration < 20).length;
        const longCalls = allCalls.filter((c: any) => c.duration >= 20).length;
        const callPattern = `Total ${totalCalls} calls: ${shortCalls} short (<20s), ${longCalls} successful (>20s).`;

        // Prepare Status History Summary
        const orderHistory = historyMap[order.id] || [];
        // Filter mainly status changes or relevant fields
        const statusChanges = orderHistory
            .filter(h => h.field === 'status')
            .map(h => {
                const date = new Date(h.occurred_at).toLocaleDateString('ru-RU');
                return `${date}: ${h.old_value || 'New'} -> ${h.new_value}`;
            });
        const statusHistoryStr = statusChanges.length > 0 ? statusChanges.join('; ') : 'No status history found.';

        // Calculate days in current status (approx if we have history)
        // (Existing logic for daysSinceUpdate is good, but history gives more context)

        // Prepare Product Info & Comments
        const payload = order.raw_payload as any || {};
        const items = (payload.items || []).map((i: any) => {
            return `${i.offer?.name || 'Unknown'} (x${i.quantity})`;
        }).join(', ');
        const productInfo = items || 'No products listed';

        const commentsContext = `Manager: "${payload.managerComment || 'None'}"\nCustomer: "${payload.customerComment || 'None'}"`;


        // Collect all possible activity timestamps (Logic preserved)
        const movementDates: number[] = [];
        if (order.updated_at) movementDates.push(new Date(order.updated_at).getTime());
        if (order.created_at) movementDates.push(new Date(order.created_at).getTime());
        if (payload.statusUpdatedAt) movementDates.push(new Date(payload.statusUpdatedAt).getTime());
        if (lastCall) movementDates.push(new Date(lastCall.timestamp).getTime());

        // Get Last 3 calls for transcripts
        const callsWithTranscript = allCalls
            .filter((c: any) => c.transcript && c.transcript.length > 10)
            .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 3);

        let transcriptHistory = '';
        if (callsWithTranscript.length > 0) {
            transcriptHistory = callsWithTranscript.map((c: any) => {
                const dateStr = new Date(c.timestamp).toLocaleDateString('ru-RU');
                return `[${dateStr}] ${c.transcript.substring(0, 1000)}`;
            }).join('\n\n');
        }

        const lastMovementTs = movementDates.length > 0 ? Math.max(...movementDates) : now.getTime();
        const daysSinceUpdate = (now.getTime() - lastMovementTs) / (1000 * 3600 * 24);

        // Rule: Stagnation
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

        let aiSummary = "Ожидание анализа";

        if (!skipAI && callsWithTranscript.length > 0) {
            const customFields = payload.customFields || {};
            const top3 = {
                price: customFields.top3_prokhodim_li_po_tsene2 === 'yes' ? 'Да' : customFields.top3_prokhodim_li_po_tsene2 === 'no' ? 'Нет' : 'Не указано',
                timing: customFields.top3_prokhodim_po_srokam1 === 'yes' ? 'Да' : customFields.top3_prokhodim_po_srokam1 === 'no' ? 'Нет' : 'Не указано',
                specs: customFields.top3_prokhodim_po_tekh_kharakteristikam === 'yes' ? 'Да' : customFields.top3_prokhodim_po_tekh_kharakteristikam === 'no' ? 'Нет' : 'Не указано'
            };

            const aiResult = await analyzeOrderWithAI(
                transcriptHistory,
                order.status,
                daysSinceUpdate,
                order.totalsumm || 0,
                {
                    productInfo,
                    commentsContext,
                    statusHistoryStr,
                    callPattern
                },
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

        // Fallback Green logic
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
    }

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
            lastActionAt: order?.updated_at,
            totalSum: order?.totalsumm || 0
        };
    }).filter(p => p.orderId);
}

// Simple in-memory cache for product catalog (Global inside module)
let cachedCatalog: string[] | null = null;
let lastCatalogFetch = 0;

async function fetchProductCatalog(): Promise<string[]> {
    const now = Date.now();
    // Refresh cache every hour
    if (cachedCatalog && (now - lastCatalogFetch < 3600 * 1000)) {
        return cachedCatalog;
    }

    try {
        const { data: orders } = await supabase
            .from('orders')
            .select('raw_payload')
            .order('created_at', { ascending: false })
            .limit(300);

        const productSet = new Set<string>();
        (orders || []).forEach((o: any) => {
            const items = o.raw_payload?.items || [];
            items.forEach((item: any) => {
                const name = item.offer?.name || item.name;
                if (name) productSet.add(name.trim());
            });
        });

        // Add core keywords as fallback
        const coreKeywords = [
            "Шкаф сушильный", "Стеллаж", "Металлическая мебель",
            "Верстак", "Сушильная камера", "Обувница"
        ];
        coreKeywords.forEach(k => productSet.add(k));

        cachedCatalog = Array.from(productSet).sort();
        lastCatalogFetch = now;
        return cachedCatalog;
    } catch (e) {
        console.error('Error fetching catalog:', e);
        return [];
    }
}

// Minimal fallback if DB is empty - NO BUSINESS LOGIC HERE
const DEFAULT_PROMPT = `
Ты - AI-помощник РОПа. 
Твоя задача - проверить заказ и выдать JSON.
В базе данных нет системного промпта.
Вердикт: "yellow"
Причина: "Системный промпт не настроен в интерфейсе".
Рекомендация: "Настройте промпт в разделе AI Инструменты".
`;

export async function analyzeOrderWithAI(
    transcript: string,
    status: string,
    daysStagnant: number,
    amount: number,
    extraContext: {
        productInfo: string;
        commentsContext: string;
        statusHistoryStr: string;
        callPattern: string;
    },
    promptTemplate?: string,
    top3?: { price: string; timing: string; specs: string }
): Promise<{
    traffic_light: 'red' | 'yellow' | 'green',
    short_reason: string,
    recommended_action: string,
    analysis_steps?: any
}> {
    const openai = getOpenAIClient();

    // Fetch catalog
    const catalog = await fetchProductCatalog();
    const catalogStr = catalog.join(', ').substring(0, 3000);

    let prompt = promptTemplate;

    // IF no template provided (most cases), fetch from DB
    if (!prompt) {
        const { data: dbPrompt } = await supabase
            .from('system_prompts')
            .select('content')
            .eq('key', 'order_analysis_main')
            .single();

        if (dbPrompt?.content) {
            prompt = dbPrompt.content;
        } else {
            prompt = DEFAULT_PROMPT;
        }
    }

    // Ensure prompt is string (even if fallback)
    prompt = prompt || DEFAULT_PROMPT;

    // Fetch training examples for few-shot learning
    const { data: examples } = await supabase
        .from('training_examples')
        .select('*')
        .limit(6);

    // Build few-shot examples
    let fewShotSection = '';
    if (examples && examples.length > 0) {
        const redExamples = examples.filter(e => e.traffic_light === 'red').slice(0, 2);
        const yellowExamples = examples.filter(e => e.traffic_light === 'yellow').slice(0, 2);
        const greenExamples = examples.filter(e => e.traffic_light === 'green').slice(0, 2);

        fewShotSection = '\n\n📚 Примеры из прошлого:\n\n';

        const formatExample = (ex: any, colorLabel: string) => {
            // We can assume examples might behave differently, but let's try to format them simply
            return `Пример (${colorLabel}): ${ex.user_reasoning} \n`;
        };

        redExamples.forEach((ex) => { fewShotSection += formatExample(ex, '🔴 КРАСНЫЙ'); });
        yellowExamples.forEach((ex) => { fewShotSection += formatExample(ex, '🟡 ЖЕЛТЫЙ'); });
        greenExamples.forEach((ex) => { fewShotSection += formatExample(ex, '🟢 ЗЕЛЕНЫЙ'); });

        fewShotSection += 'Используй эти примеры как ориентир.\n\n---\n\n';
    }

    // Prepare top3 string
    const top3Str = top3
        ? `\n- TOP-3 (Цена/Срок/Тех): ${top3.price}/${top3.timing}/${top3.specs}`
        : '';

    // Check if template has new tags, if not, append context manually for safety
    const hasNewTags = prompt.includes('{{product_info}}');

    prompt = prompt
        .replace('{{catalog_sample}}', catalogStr) // [NEW] Replace catalog tag
        .replace('{{days}}', Math.round(daysStagnant).toString())
        .replace('{{transcript}}', transcript.substring(0, 3000))
        .replace('{{sum}}', amount.toString())
        .replace('{{status}}', `${status}${top3Str}`)
        .replace('{{product_info}}', extraContext.productInfo)
        .replace('{{comments_context}}', extraContext.commentsContext)
        .replace('{{status_history}}', extraContext.statusHistoryStr)
        .replace('{{call_pattern}}', extraContext.callPattern);

    if (!hasNewTags && promptTemplate) {
        // Fallback: Append context if using an old custom prompt from DB
        prompt += `\n\nДОПОЛНИТЕЛЬНЫЙ КОНТЕКСТ:\n` +
            `Product: ${extraContext.productInfo}\n` +
            `Comments: ${extraContext.commentsContext}\n` +
            `History: ${extraContext.statusHistoryStr}\n` +
            `Calls: ${extraContext.callPattern}\n`;
    }

    // Insert few-shot examples
    if (prompt.includes('💡 ФОРМАТ')) {
        prompt = prompt.replace('💡 ФОРМАТ', fewShotSection + '💡 ФОРМАТ');
    } else if (prompt.includes('💡 Вывод')) {
        prompt = prompt.replace('💡 Вывод', fewShotSection + '💡 Вывод');
    } else {
        prompt = fewShotSection + prompt;
    }

    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.3
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error("No AI response");

    return JSON.parse(content);
}

