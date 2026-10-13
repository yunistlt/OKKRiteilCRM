/**
 * Привязка звонка к заказу в ОКК.
 *
 * Решение владельца 05.10.2026: входящий звонок тоже должен знать свой заказ, и
 * мы его больше не угадываем. Способа три, и все они пишутся в тот же
 * `call_order_matches`, где живёт старый матчинг, — отдельного хранилища нет:
 *
 *   `okk_card` — набран из карточки заказа (ставится при наборе);
 *   `okk_auto` — клиент однозначно опознан по номеру и у него РОВНО ОДИН
 *                открытый заказ: другого толкования нет;
 *   `manual`   — менеджер указал заказ сам;
 *   `ai_suggested` — подсказка по расшифровке. В связь звонка с заказом не
 *                попадает, пока человек не подтвердит.
 *
 * Почему автомат такой строгий: на живых входящих за две недели клиент
 * находится по номеру лишь у 11 номеров из 40, и у найденного обычно 2–5
 * заказов. Угадывание в таких условиях — это и есть старый матчинг, который
 * ошибается примерно в трети случаев.
 */
import { supabase } from '@/utils/supabase';
import { findOrderCandidatesByPhone } from '@/lib/call-matching';
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { cachedAiResult } from '@/lib/ai-cache';
import { recordAiUsage, AiAgent } from '@/lib/ai-usage';
import { cutForAi } from '@/lib/email/classify';

export type BindMethod = 'okk_card' | 'okk_auto' | 'manual' | 'ai_suggested';

/** Последние десять цифр: номер в базе записан как придётся. */
export function phoneKey(value: any): string | null {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : null;
}

/** Звонок уже привязан — чем-то надёжнее догадки по телефону? */
export async function existingBinding(callId: string): Promise<{ orderId: number; method: string } | null> {
    const { data } = await supabase
        .from('call_order_matches')
        .select('retailcrm_order_id, match_type')
        .ilike('telphin_call_id', callId)
        .neq('match_type', 'ai_suggested')
        .limit(5);

    const rank: Record<string, number> = { okk_card: 1, manual: 2, okk_auto: 3, retailcrm: 4 };
    const rows = ((data ?? []) as any[])
        .map((r) => ({ orderId: Number(r.retailcrm_order_id), method: String(r.match_type) }))
        .sort((a, b) => (rank[a.method] ?? 9) - (rank[b.method] ?? 9));

    return rows[0] ?? null;
}

/** Записать привязку. Повторный вызов обновляет её, а не плодит строки. */
export async function bindCallToOrder(input: {
    callId: string;
    orderId: number;
    method: BindMethod;
    reason: string;
    by?: string | null;
    suggested?: boolean;
}): Promise<void> {
    // Идентификатор храним прописными: Телфин отдаёт его так, и только так две
    // записи одного разговора сходятся.
    const callKey = String(input.callId).toUpperCase();

    await supabase.from('call_order_matches').upsert(
        [{
            telphin_call_id: callKey,
            retailcrm_order_id: input.orderId,
            match_type: input.suggested ? 'ai_suggested' : input.method,
            confidence_score: input.method === 'okk_card' || input.method === 'manual' ? 1.0 : 0.95,
            matched_at: new Date().toISOString(),
            rule_id: 'okk_v1',
            explanation: input.by ? `${input.reason} (${input.by})` : input.reason,
        }],
        { onConflict: 'telphin_call_id,retailcrm_order_id' },
    );
}

export type OrderChoice = {
    orderId: number;
    number: string;
    status: string | null;
    managerId: number | null;
    createdAt: string | null;
};

/**
 * Заказы, к которым может относиться звонок с этого номера.
 *
 * Кандидатов ищет уже написанный поиск по телефону из матчинга
 * (`findOrderCandidatesByPhone`): он сравнивает по последним семи цифрам и
 * переживает добавочные. Здесь он только дополняется человеческими полями —
 * номером заказа и статусом, чтобы менеджеру было из чего выбирать.
 */
export async function ordersByPhone(phone: string, limit = 20): Promise<OrderChoice[]> {
    const candidates = await findOrderCandidatesByPhone(phone);
    if (!candidates.length) return [];

    const ids = candidates.map((c) => c.retailcrm_order_id).slice(0, limit);
    const { data } = await supabase
        .from('orders')
        .select('id, number, status, manager_id, "createdAt"')
        .in('id', ids)
        .is('crm_deleted_at', null)
        .order('createdAt', { ascending: false });

    return ((data ?? []) as any[]).map((row) => ({
        orderId: Number(row.id),
        number: String(row.number ?? row.id),
        status: row.status ?? null,
        managerId: row.manager_id === null || row.manager_id === undefined ? null : Number(row.manager_id),
        createdAt: row.createdAt ?? null,
    }));
}

/** Какие статусы считаем работающими: заказ в них ведут прямо сейчас. */
async function workingStatuses(): Promise<Set<string>> {
    const { data } = await supabase.from('crm_statuses').select('external_code, is_working').eq('is_working', true);
    return new Set(((data ?? []) as any[]).map((r) => String(r.external_code)).filter(Boolean));
}

/**
 * Строгая автопривязка звонка.
 *
 * Привязываем, только когда толкование одно: клиент опознан по номеру и у него
 * ровно один открытый заказ. Иначе не трогаем — заказ укажет менеджер. Так
 * вместо догадок матчинга получается либо точная привязка, либо честное «не
 * знаем».
 *
 * Возвращает заказ, если привязали.
 */
export async function autoBindCall(callId: string, phone: string): Promise<OrderChoice | null> {
    const already = await existingBinding(callId);
    if (already) return null;

    const orders = await ordersByPhone(phone, 50);
    if (!orders.length) return null;

    const working = await workingStatuses();
    const open = orders.filter((o) => o.status && working.has(o.status));
    if (open.length !== 1) return null;

    const only = open[0];
    await bindCallToOrder({
        callId,
        orderId: only.orderId,
        method: 'okk_auto',
        reason: `Клиент опознан по номеру, и у него один открытый заказ №${only.number}`,
        by: 'ОКК',
    });

    return only;
}

/**
 * Номер клиента в звонке: у входящего — кто звонил, у исходящего — кому.
 */
export function clientPhoneOfCall(call: {
    direction?: string | null;
    from_number?: string | null;
    to_number?: string | null;
    from_number_normalized?: string | null;
    to_number_normalized?: string | null;
}): string | null {
    const incoming = call.direction === 'incoming';
    const value = incoming
        ? call.from_number_normalized || call.from_number
        : call.to_number_normalized || call.to_number;
    return phoneKey(value) ? String(value) : null;
}

/**
 * Привязка звонка по правилам ОКК: то, что раньше делал матчинг по телефону.
 * Возвращает заказы, с которыми звонок связан после этой попытки.
 */
export async function bindCallStrict(call: {
    telphin_call_id: string;
    direction?: string | null;
    from_number?: string | null;
    to_number?: string | null;
    from_number_normalized?: string | null;
    to_number_normalized?: string | null;
}): Promise<number[]> {
    const existing = await existingBinding(call.telphin_call_id);
    if (existing) return [existing.orderId];

    const phone = clientPhoneOfCall(call);
    if (!phone) return [];

    const bound = await autoBindCall(call.telphin_call_id, phone);
    return bound ? [bound.orderId] : [];
}

/**
 * Подсказка заказа по расшифровке разговора.
 *
 * Третий способ из решения владельца 05.10.2026. Это именно ПОДСКАЗКА: пишется
 * типом `ai_suggested`, в связь звонка с заказом не попадает, пока менеджер её
 * не подтвердит, — иначе это был бы тот же матчинг, только по тексту.
 *
 * Сначала ищем номер заказа цифрами: бесплатно и точно. Если не нашли, зовём
 * разбор текста — в разговоре номер чаще звучит прописью («по заказу сорок
 * девять триста восемьдесят восемь») либо называется компания. Разбор идёт
 * только по звонкам без привязки и с расшифровкой (за 30 дней таких 278), на
 * дешёвой модели и с кэшем, чтобы один и тот же текст не разбирался дважды.
 */
export async function suggestOrderFromTranscript(callId: string, transcript: string): Promise<number | null> {
    const text = String(transcript ?? '');
    if (text.length < 20) return null;

    const numbers = Array.from(new Set((text.match(/\b\d{4,7}\b/g) ?? []))).slice(0, 40);
    const fromDigits = numbers.length ? await singleOrderByNumbers(numbers) : null;
    if (fromDigits) {
        await saveSuggestion(callId, fromDigits.id, `В разговоре прозвучал номер заказа №${fromDigits.number}`);
        return fromDigits.id;
    }

    const spoken = await orderNumberFromSpeech(text);
    if (!spoken) return null;

    const found = await singleOrderByNumbers([spoken]);
    if (!found) return null;

    await saveSuggestion(callId, found.id, `В разговоре назвали заказ №${found.number}`);
    return found.id;
}

/** Заказ, если названный номер один и он существует. */
async function singleOrderByNumbers(numbers: string[]): Promise<{ id: number; number: string } | null> {
    const { data } = await supabase
        .from('orders')
        .select('id, number')
        .in('number', numbers)
        .is('crm_deleted_at', null)
        .limit(5);

    const found = (data ?? []) as any[];
    if (found.length !== 1) return null;
    return { id: Number(found[0].id), number: String(found[0].number) };
}

async function saveSuggestion(callId: string, orderId: number, reason: string): Promise<void> {
    await bindCallToOrder({
        callId,
        orderId,
        method: 'ai_suggested',
        reason,
        by: 'Разбор разговора',
        suggested: true,
    });
}

/**
 * Номер заказа, названный в разговоре словами.
 *
 * Цифрами его в расшифровке почти не бывает: на 20 текстах цифры нашлись в
 * одном, и то это были размеры. Поэтому спрашиваем разбор — коротко и на
 * дешёвой модели.
 */
async function orderNumberFromSpeech(text: string): Promise<string | null> {
    if (!isOpenAIConfigured()) return null;

    const system = `Ты разбираешь расшифровку телефонного разговора отдела продаж.
Найди НОМЕР ЗАКАЗА или СЧЁТА, который называют собеседники (часто прописью: «сорок девять триста восемьдесят восемь»).
Это 4–7 цифр. Размеры, количества, цены, даты и телефоны номером заказа НЕ являются.
Верни JSON: {"number": "49388"} либо {"number": null}, если номера не называли.`;
    // Режем целыми символами: обрубленное эмодзи ломает запрос к разбору
    // (поймано на письмах 05.10.2026).
    const user = cutForAi(text, 4000);

    try {
        const { value } = await cachedAiResult<any>({
            purpose: 'call_order_hint',
            keyParts: [system, user],
            run: async () => {
                const openai = getOpenAIClient();
                const res = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    temperature: 0,
                    response_format: { type: 'json_object' },
                    messages: [
                        { role: 'system', content: system },
                        { role: 'user', content: user },
                    ],
                });
                await recordAiUsage({ agentId: AiAgent.SEMEN, model: res.model, usage: res.usage, purpose: 'call_order_hint' });
                return JSON.parse(res.choices[0].message.content || '{}');
            },
        });

        const number = String(value?.number ?? '').replace(/\D/g, '');
        return /^\d{4,7}$/.test(number) ? number : null;
    } catch (e: any) {
        console.error('[call-binding] разбор номера заказа не удался:', e?.message);
        return null;
    }
}

/**
 * Кто звонит: карточка клиента по номеру телефона.
 *
 * Нужна оповещению о входящем: даже когда заказ неизвестен, человеку надо
 * сказать, кто на линии, а не только показать номер (решение владельца
 * 05.10.2026). Сначала ищем компанию, потом живого человека — у компании есть
 * название, по нему менеджер узнаёт клиента быстрее.
 *
 * Телефоны в карточках лежат массивом и записаны по-разному: «+79270804167»,
 * «89270809086», «79040941225». Поэтому ищем пересечение с набором написаний
 * одного и того же номера, а не точное совпадение строки.
 */
function phoneVariants(phone: string): string[] {
    const key = phoneKey(phone);
    if (!key) return [];
    return Array.from(new Set([key, `7${key}`, `8${key}`, `+7${key}`]));
}

export async function clientByPhone(phone: string): Promise<{ name: string; clientId: number | null } | null> {
    const variants = phoneVariants(phone);
    if (!variants.length) return null;

    const { data: company } = await supabase
        .from('clients')
        .select('id, company_name, "legalName", contact_name')
        .overlaps('phones', variants)
        .limit(1);

    const found = ((company ?? []) as any[])[0];
    if (found) {
        const name = found.company_name || found.legalName || found.contact_name;
        if (name) return { name: String(name), clientId: Number(found.id) };
    }

    const { data: person } = await supabase
        .from('customers')
        .select('id, "firstName", "lastName"')
        .overlaps('phones', variants)
        .limit(1);

    const human = ((person ?? []) as any[])[0];
    if (!human) return null;

    const name = [human.lastName, human.firstName].filter(Boolean).join(' ').trim();
    return name ? { name, clientId: null } : null;
}
