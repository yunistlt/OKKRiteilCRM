// ============================================================================
// Классификатор «смета ли это» по диалогу с клиентом.
//
// Зачем: правило «Смета» (lib/salary/estimates.ts) исключает заказ из конверсии
// по причине отмены безусловно, а по текстовому маркеру в комментарии — только
// с подтверждением по диалогу. Маркер сам по себе шумный: «не работают по
// сметам», «запрос сметы был» — это не смета в нашем смысле. Подтверждение даёт
// этот классификатор: читает расшифровки звонков по заказу и отвечает, сказал ли
// клиент, что закупка не раньше чем через год либо срок неизвестен.
//
// Вердикт кладётся в order_estimate_verdicts и оттуда читается расчётом ЗП.
// Модель в расчёте НЕ вызывается — только готовый вердикт из таблицы.
//
// is_estimate = null означает «нет данных для решения» (звонков не было,
// расшифровок нет, о сроке закупки в диалоге не говорили). Такой заказ остаётся
// в конверсии — это встроенный контроль злоупотребления, как у правил дублей.
//
// Промпт живёт в ai_prompts (ключ salary_estimate_classifier), в коде — только
// минимальный фолбэк на случай пустой таблицы. Знания агентов в РАГ, не в файлах.
// ============================================================================

import { supabase } from '@/utils/supabase';
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { getSystemPrompt } from '@/lib/quality-control';
import { recordAiUsage, AiAgent } from '@/lib/ai-usage';
import { getConfigForPeriod } from '@/lib/salary/config';
import { hasEstimateMarker } from '@/lib/salary/estimates';

export const ESTIMATE_PROMPT_KEY = 'salary_estimate_classifier';

// Фолбэк — не «знание», а страховка от пустой ai_prompts: без промпта воркер бы
// молча размечал заказы мусором. Рабочая версия редактируется в /settings/prompts.
const FALLBACK_PROMPT = [
    'Ты аналитик отдела продаж. По расшифровкам звонков определи, был ли это запрос цены для сметы/бюджета,',
    'а не реальная закупка. Признак сметы: клиент говорит, что закупка планируется не раньше чем через год,',
    'или срок закупки неизвестен, или цена нужна для закладки в бюджет будущего периода.',
    'Ответ строго JSON: {"is_estimate": true|false|null, "horizon": "god_plus"|"neizvestno"|"blizhaishii"|null,',
    '"confidence": 0..1, "reasoning": "кратко по-русски", "quotes": ["цитата из диалога"]}.',
    'is_estimate = null, если о сроке закупки в диалоге ничего нет. Не выдумывай: опирайся только на реплики.',
].join(' ');

export type EstimateClassifyStatus = 'updated' | 'skipped_no_data' | 'skipped_no_ai';

export interface EstimateClassifyResult {
    status: EstimateClassifyStatus;
    isEstimate: boolean | null;
    confidence: number | null;
    reasoning: string | null;
}

interface OrderRow {
    order_id: number;
    status: string;
    raw_payload: any;
}

/** Расшифровки всех звонков заказа, склеенные в один текст для модели. */
async function loadTranscripts(orderId: number): Promise<{ text: string; callIds: string[] }> {
    const { data: matches } = await supabase
        .from('call_order_matches')
        .select('telphin_call_id')
        .eq('retailcrm_order_id', orderId);
    const callIds = Array.from(
        new Set(((matches as any[]) ?? []).map((m) => String(m.telphin_call_id)).filter(Boolean)),
    );
    if (!callIds.length) return { text: '', callIds: [] };

    const { data: calls } = await supabase
        .from('raw_telphin_calls')
        .select('telphin_call_id,started_at,transcript')
        .in('telphin_call_id', callIds)
        .order('started_at', { ascending: true });

    const used: string[] = [];
    const parts: string[] = [];
    for (const c of (calls as any[]) ?? []) {
        const transcript = String(c.transcript ?? '').trim();
        if (!transcript) continue;
        used.push(String(c.telphin_call_id));
        const when = c.started_at ? String(c.started_at).slice(0, 16).replace('T', ' ') : 'без даты';
        parts.push(`— Звонок ${when} —\n${transcript}`);
    }
    return { text: parts.join('\n\n'), callIds: used };
}

/**
 * Классифицирует заказ и сохраняет вердикт в order_estimate_verdicts.
 * Идемпотентна: повторный вызов перезаписывает вердикт по тому же заказу.
 */
export async function classifyOrderEstimate(orderId: number): Promise<EstimateClassifyResult> {
    if (!isOpenAIConfigured()) {
        return { status: 'skipped_no_ai', isEstimate: null, confidence: null, reasoning: null };
    }

    const { data: orderRow, error: orderErr } = await supabase
        .from('orders')
        .select('order_id,status,raw_payload')
        .eq('order_id', orderId)
        .single();
    if (orderErr) throw orderErr;
    const order = orderRow as unknown as OrderRow;

    // Правило берём на месяц создания заказа: конфиг effective-dated, статусы и
    // маркеры могли меняться. Заказ вне правила классифицировать незачем.
    const createdAt = new Date(order.raw_payload?.createdAt ?? Date.now());
    const rule = (await getConfigForPeriod(createdAt.getFullYear(), createdAt.getMonth() + 1)).estimate_rule;
    const marked = hasEstimateMarker(
        {
            managerComment: order.raw_payload?.managerComment ?? null,
            customerComment: order.raw_payload?.customerComment ?? null,
        },
        rule,
    );
    if (!rule.statuses.includes(String(order.status ?? '')) || !marked) {
        return { status: 'skipped_no_data', isEstimate: null, confidence: null, reasoning: null };
    }

    const { text, callIds } = await loadTranscripts(orderId);
    if (!text) {
        // Разговоров нет — решать не на чем. Пишем «нет данных», чтобы воркер не
        // возвращался к заказу и было видно, почему он остался в конверсии.
        await saveVerdict(orderId, {
            is_estimate: null,
            confidence: null,
            horizon: null,
            reasoning: 'Нет расшифровок звонков по заказу — подтвердить смету нечем.',
            evidence: { call_ids: [] },
            model: null,
        });
        return { status: 'skipped_no_data', isEstimate: null, confidence: null, reasoning: null };
    }

    const { prompt, model } = await getSystemPrompt(ESTIMATE_PROMPT_KEY, FALLBACK_PROMPT);
    const userPrompt = [
        `Комментарий менеджера: ${order.raw_payload?.managerComment ?? '(пусто)'}`,
        `Комментарий клиента: ${order.raw_payload?.customerComment ?? '(пусто)'}`,
        '',
        'Расшифровки звонков по заказу:',
        text.slice(0, 40000),
    ].join('\n');

    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
        model: model || 'gpt-4o-mini',
        messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
    });
    await recordAiUsage({
        agentId: AiAgent.ANNA,
        model: completion.model,
        usage: completion.usage,
        purpose: 'salary_estimate_classify',
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('Пустой ответ модели при классификации сметы');
    const parsed = JSON.parse(content) as {
        is_estimate?: boolean | null;
        horizon?: string | null;
        confidence?: number | null;
        reasoning?: string | null;
        quotes?: string[];
    };

    const isEstimate = parsed.is_estimate === true ? true : parsed.is_estimate === false ? false : null;
    const confidence = parsed.confidence == null ? null : Number(parsed.confidence);

    await saveVerdict(orderId, {
        is_estimate: isEstimate,
        confidence: Number.isFinite(confidence as number) ? confidence : null,
        horizon: parsed.horizon ?? null,
        reasoning: parsed.reasoning ?? null,
        evidence: { call_ids: callIds, quotes: parsed.quotes ?? [] },
        model: completion.model,
    });

    return {
        status: 'updated',
        isEstimate,
        confidence: confidence ?? null,
        reasoning: parsed.reasoning ?? null,
    };
}

/**
 * Заказы, которым нужен вердикт: в статусе правила, с текстовым маркером сметы и
 * ещё без строки в order_estimate_verdicts. Ветку «причина отмены = Смета» сюда
 * не берём — она исключает заказ без всякого ИИ.
 *
 * Используется воркером как самоподхват: очередь пуста → добираем бэклог. Так не
 * приходится врезаться в горячий путь синка заказов, а история размечается сама.
 */
export async function findEstimateCandidates(limit: number, monthsBack = 6): Promise<number[]> {
    const since = new Date();
    since.setMonth(since.getMonth() - monthsBack);
    const now = new Date();
    const rule = (await getConfigForPeriod(now.getFullYear(), now.getMonth() + 1)).estimate_rule;
    if (!rule.statuses.length || !rule.comment_patterns.length) return [];

    const { data } = await supabase
        .from('orders')
        .select('order_id,raw_payload')
        .in('status', rule.statuses)
        .gte('created_at', since.toISOString())
        .range(0, 9999);

    const marked: number[] = [];
    for (const o of (data as any[]) ?? []) {
        if (o.order_id == null) continue;
        const hit = hasEstimateMarker(
            {
                managerComment: o.raw_payload?.managerComment ?? null,
                customerComment: o.raw_payload?.customerComment ?? null,
            },
            rule,
        );
        if (hit) marked.push(Number(o.order_id));
    }
    if (!marked.length) return [];

    const { data: done } = await supabase
        .from('order_estimate_verdicts')
        .select('retailcrm_order_id')
        .in('retailcrm_order_id', marked);
    const seen = new Set(((done as any[]) ?? []).map((d) => Number(d.retailcrm_order_id)));

    return marked.filter((id) => !seen.has(id)).slice(0, limit);
}

async function saveVerdict(
    orderId: number,
    row: {
        is_estimate: boolean | null;
        confidence: number | null;
        horizon: string | null;
        reasoning: string | null;
        evidence: Record<string, any>;
        model: string | null;
    },
): Promise<void> {
    const { error } = await supabase
        .from('order_estimate_verdicts')
        .upsert(
            { retailcrm_order_id: orderId, ...row, evaluated_at: new Date().toISOString() },
            { onConflict: 'retailcrm_order_id' },
        );
    if (error) throw error;
}
