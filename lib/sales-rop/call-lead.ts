/**
 * ИИ-РОП заводит заказ по звонку, который менеджер не оформил.
 *
 * Решение владельца 22.11.2026. Голосовой секретарь Телфина заказы не заводит,
 * а за 14 дней 135 разговоров с незнакомых номеров так и остались без заказа.
 * Большинство из них — не покупатели (наш клиент с другого номера, поставщики,
 * перевозчики, бухгалтерия), но новые запросы среди них есть, и терять их нельзя.
 *
 * Путь одного звонка:
 *   1. входящий, разговор не короче порога, есть расшифровка;
 *   2. ждём `call_lead_wait_minutes` — менеджер успевает завести заказ сам;
 *   3. по этому телефону уже есть заказ (был раньше или завели сейчас) или
 *      звонок привязан к заказу — не наше дело, пропускаем;
 *   4. модель читает расшифровку: новый запрос на нашу продукцию или нет;
 *   5. да — заказ «Новая» на того, кто говорил, звонок привязывается к нему.
 *
 * Каждое решение, и «завёл», и «пропустил», пишется в `call_lead_reviews` с
 * причиной — по журналу видно, что ИИ-РОП делает и где ошибается.
 */
import { supabase } from '@/utils/supabase';
import { getOpenAIClient, isOpenAIConfigured } from '@/utils/openai';
import { AiAgent, recordAiUsage } from '@/lib/ai-usage';
import { cutForAi } from '@/lib/email/classify';
import { findOrdersByPhone, phoneTail7 } from '@/lib/orders-by-phone';
import { bindCallToOrder, existingBinding } from '@/lib/call-binding';
import { createCallLead } from '@/lib/retailcrm/leads';

export const CALL_LEAD_PROMPT_KEY = 'sales_call_lead';

/** Ниже этой уверенности модели заказ не заводим: лишний заказ хуже пропущенного. */
export const MIN_CONFIDENCE = 0.7;

/** Сколько звонков разбираем за один проход крона. */
const BATCH = 20;

/** Через сколько минут зависший «в работе» звонок можно брать снова. */
const STALE_CLAIM_MINUTES = 15;

export type CallLeadSettings = {
    enabled: boolean;
    waitMinutes: number;
    minSeconds: number;
    lookbackHours: number;
};

export async function loadCallLeadSettings(): Promise<CallLeadSettings> {
    const { data } = await supabase
        .from('sales_rop_settings')
        .select('key, value')
        .in('key', ['call_lead_enabled', 'call_lead_wait_minutes', 'call_lead_min_seconds', 'call_lead_lookback_hours']);
    const map = new Map(((data ?? []) as any[]).map((r) => [r.key, r.value]));
    const num = (key: string, fallback: number) => {
        const v = Number(map.get(key));
        return Number.isFinite(v) && v >= 0 ? v : fallback;
    };
    return {
        enabled: String(map.get('call_lead_enabled') ?? 'false') === 'true',
        waitMinutes: num('call_lead_wait_minutes', 120),
        minSeconds: num('call_lead_min_seconds', 30),
        lookbackHours: num('call_lead_lookback_hours', 48),
    };
}

export type CallCandidate = {
    callId: string;
    startedAt: string;
    durationSec: number;
    phone: string;
    managerExtension: string | null;
    transcript: string;
};

/** Звонки, у которых вышло время ожидания и по которым ещё нет решения. */
export async function findCandidateCalls(settings: CallLeadSettings, now: Date, limit = BATCH): Promise<CallCandidate[]> {
    const from = new Date(now.getTime() - settings.lookbackHours * 3600_000).toISOString();
    const to = new Date(now.getTime() - settings.waitMinutes * 60_000).toISOString();

    const { data, error } = await supabase
        .from('raw_telphin_calls')
        .select('telphin_call_id, started_at, duration_sec, from_number, manager_extension, transcript')
        .eq('direction', 'incoming')
        .eq('transcription_status', 'completed')
        .gte('duration_sec', settings.minSeconds)
        .gte('started_at', from)
        .lte('started_at', to)
        .order('started_at', { ascending: true })
        .limit(Math.max(200, limit * 4));
    if (error) throw new Error(error.message);

    const rows = ((data ?? []) as any[]).filter((r) => r.telphin_call_id && r.transcript);
    if (!rows.length) return [];

    const ids = rows.map((r) => String(r.telphin_call_id));
    const staleIso = new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000).toISOString();
    const { data: done } = await supabase
        .from('call_lead_reviews')
        .select('telphin_call_id, decision, updated_at')
        .in('telphin_call_id', ids);
    const closed = new Set(
        ((done ?? []) as any[])
            .filter((r) => r.decision !== 'error' || r.updated_at > staleIso)
            .map((r) => String(r.telphin_call_id)),
    );

    return rows
        .filter((r) => !closed.has(String(r.telphin_call_id)))
        .slice(0, limit)
        .map((r) => ({
            callId: String(r.telphin_call_id),
            startedAt: String(r.started_at),
            durationSec: Number(r.duration_sec) || 0,
            phone: String(r.from_number || ''),
            managerExtension: r.manager_extension ? String(r.manager_extension).trim() : null,
            transcript: String(r.transcript),
        }));
}

/**
 * Причина не разбирать звонок, которую видно без модели. null — разбирать.
 * Сюда же попадает «менеджер завёл заказ сам»: заказ с этим телефоном появился.
 */
export async function skipBeforeAi(call: CallCandidate): Promise<{ category: string; reason: string } | null> {
    if (!phoneTail7(call.phone)) {
        return { category: 'no_phone', reason: 'Номер не определился или короткий — это не внешний клиент.' };
    }

    const orders = await findOrdersByPhone(call.phone, { columns: 'id, number, created_at', limit: 1, withDeleted: true });
    if (orders.length) {
        const order = orders[0];
        const after = order.created_at && new Date(order.created_at) > new Date(call.startedAt);
        return {
            category: after ? 'manager_created' : 'known_number',
            reason: after
                ? `По этому телефону после звонка завели заказ ${order.number ?? order.id}.`
                : `По этому телефону уже есть заказ ${order.number ?? order.id} — клиент не новый.`,
        };
    }

    const bound = await existingBinding(call.callId);
    if (bound) {
        return { category: 'bound', reason: `Звонок уже привязан к заказу (${bound.method}).` };
    }

    return null;
}

export type CallVerdict = {
    category: string;
    createOrder: boolean;
    confidence: number;
    reason: string;
    summary: string;
    clientName: string | null;
    company: string | null;
    model: string;
};

const CATEGORIES = ['new_request', 'existing_order', 'supplier', 'logistics', 'finance', 'job', 'wrong_number', 'no_talk', 'other'];

/** Разбор ответа модели. Заводим заказ, только если модель уверена и это новый запрос. */
export function parseVerdict(raw: string, model: string): CallVerdict {
    const parsed = JSON.parse(raw);
    const category = CATEGORIES.includes(parsed.category) ? parsed.category : 'other';
    const conf = Number(parsed.confidence);
    const confidence = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0;
    const text = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim() : null);
    return {
        category,
        createOrder: parsed.create_order === true && category === 'new_request' && confidence >= MIN_CONFIDENCE,
        confidence,
        reason: text(parsed.reason) ?? '',
        summary: text(parsed.summary) ?? '',
        clientName: text(parsed.client_name),
        company: text(parsed.company),
        model,
    };
}

export async function classifyCall(transcript: string): Promise<CallVerdict> {
    if (!isOpenAIConfigured()) throw new Error('OpenAI не настроен');

    const { data: prompt } = await supabase
        .from('ai_prompts')
        .select('system_prompt, model, temperature, max_tokens')
        .eq('key', CALL_LEAD_PROMPT_KEY)
        .eq('is_active', true)
        .maybeSingle();
    if (!prompt?.system_prompt) throw new Error(`Нет активного промпта ${CALL_LEAD_PROMPT_KEY}`);

    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
        model: prompt.model || 'gpt-4o-mini',
        temperature: Number(prompt.temperature ?? 0),
        max_tokens: Number(prompt.max_tokens ?? 500),
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: prompt.system_prompt },
            { role: 'user', content: `Расшифровка звонка:\n${cutForAi(transcript, 6000)}` },
        ],
    });

    await recordAiUsage({
        agentId: AiAgent.SALES_ANALYST,
        model: completion.model,
        usage: completion.usage,
        purpose: 'sales_call_lead',
    }).catch(() => null);

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('Пустой ответ модели');
    return parseVerdict(raw, completion.model);
}

/** Кто говорил: менеджер по добавочному, на который пришёл разговор. */
export async function managerByExtension(extension: string | null): Promise<number | null> {
    if (!extension) return null;
    const { data } = await supabase
        .from('managers')
        .select('id')
        .eq('telphin_extension', extension)
        .eq('active', true)
        .limit(1);
    const id = Number((data as any[])?.[0]?.id);
    return Number.isFinite(id) && id > 0 ? id : null;
}

/** Окно сверки со свежими заказами: письмо могло прийти и до звонка («мы вам писали»). */
const MATCH_WINDOW_HOURS = 48;
const MATCH_PROMPT_KEY = 'sales_call_lead_match';

export type RecentOrder = {
    id: number;
    number: string;
    createdAt: string;
    line: string;
};

const SOURCE_NAMES: Record<string, string> = {
    'email-secretary': 'письмо',
    'ai-widget': 'сайт',
    'crm-manager': 'менеджер',
    'telphin-secretary': 'звонок',
    'call-ai': 'звонок (ИИ-РОП)',
};

/** Заказы, заведённые рядом со звонком, — кандидаты в «тот же запрос». */
export async function recentOrdersAround(call: CallCandidate, until: Date): Promise<RecentOrder[]> {
    const from = new Date(new Date(call.startedAt).getTime() - MATCH_WINDOW_HOURS * 3600_000).toISOString();
    const { data, error } = await supabase
        .from('orders')
        .select('id, number, created_at, phone, src:raw_payload->source->>source, company:raw_payload->customer->>nickName, email:raw_payload->>email, person:raw_payload->>firstName, comment:raw_payload->>customerComment')
        .gte('created_at', from)
        .lte('created_at', until.toISOString())
        .is('crm_deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(80);
    if (error) throw new Error(error.message);

    return ((data ?? []) as any[]).map((o) => {
        const when = new Date(o.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const text = String(o.comment || '').replace(/\s+/g, ' ').slice(0, 260);
        const parts = [
            `№${o.number}`,
            when,
            SOURCE_NAMES[o.src] || o.src || '—',
            o.company || o.person || '—',
            o.email || '',
            o.phone || '',
            text,
        ].filter(Boolean);
        return { id: Number(o.id), number: String(o.number), createdAt: String(o.created_at), line: parts.join(' | ') };
    });
}

/** Модель ищет среди свежих заказов тот же запрос. null — совпадения нет. */
export async function matchExistingOrder(
    call: CallCandidate,
    verdict: CallVerdict,
    orders: RecentOrder[],
): Promise<{ order: RecentOrder; reason: string } | null> {
    if (!orders.length) return null;

    const { data: prompt } = await supabase
        .from('ai_prompts')
        .select('system_prompt, model, temperature, max_tokens')
        .eq('key', MATCH_PROMPT_KEY)
        .eq('is_active', true)
        .maybeSingle();
    if (!prompt?.system_prompt) throw new Error(`Нет активного промпта ${MATCH_PROMPT_KEY}`);

    const callBlock = [
        `Звонок: ${new Date(call.startedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}, телефон ${call.phone}`,
        verdict.company ? `Компания: ${verdict.company}` : '',
        verdict.clientName ? `Звонящий: ${verdict.clientName}` : '',
        `Суть: ${verdict.summary}`,
        `Расшифровка: ${cutForAi(call.transcript, 2000)}`,
    ].filter(Boolean).join('\n');

    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
        model: prompt.model || 'gpt-4o-mini',
        temperature: Number(prompt.temperature ?? 0),
        max_tokens: Number(prompt.max_tokens ?? 200),
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: prompt.system_prompt },
            { role: 'user', content: `${callBlock}\n\nЗаказы:\n${orders.map((o) => o.line).join('\n')}` },
        ],
    });
    await recordAiUsage({ agentId: AiAgent.SALES_ANALYST, model: completion.model, usage: completion.usage, purpose: 'sales_call_lead_match' }).catch(() => null);

    const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
    const number = String(parsed.order_number ?? '').replace(/\D/g, '');
    if (!number) return null;
    const order = orders.find((o) => o.number === number);
    return order ? { order, reason: String(parsed.reason || '').trim() } : null;
}

type JournalRow = {
    decision: 'created' | 'skipped' | 'error';
    category?: string | null;
    reason?: string | null;
    summary?: string | null;
    order_id?: number | null;
    manager_id?: number | null;
    model?: string | null;
};

/**
 * Занять звонок, чтобы два прохода крона не завели два заказа. Свободен —
 * вставляем строку; занят «ошибкой», которая давно не обновлялась, — берём снова.
 */
async function claim(call: CallCandidate, now: Date): Promise<boolean> {
    const base = {
        telphin_call_id: call.callId,
        call_started_at: call.startedAt,
        phone: call.phone,
        decision: 'error',
        reason: 'в работе',
        updated_at: now.toISOString(),
    };
    const { error } = await supabase.from('call_lead_reviews').insert(base);
    if (!error) return true;
    if ((error as any).code !== '23505') throw new Error(error.message);

    const staleIso = new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000).toISOString();
    const { data } = await supabase
        .from('call_lead_reviews')
        .update(base)
        .eq('telphin_call_id', call.callId)
        .eq('decision', 'error')
        .lt('updated_at', staleIso)
        .select('id');
    return Boolean((data as any[])?.length);
}

async function writeJournal(callId: string, row: JournalRow) {
    await supabase
        .from('call_lead_reviews')
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq('telphin_call_id', callId);
}

export type CallDecision = JournalRow & { callId: string; startedAt: string; phone: string; orderNumber?: string | null };

/**
 * Разобрать один звонок. В пробном прогоне (`dryRun`) ничего не пишем и заказов
 * не заводим — только говорим, что сделали бы.
 */
export async function reviewCall(
    call: CallCandidate,
    opts: { dryRun?: boolean; now?: Date; waitMinutes?: number } = {},
): Promise<CallDecision> {
    const now = opts.now ?? new Date();
    const head = { callId: call.callId, startedAt: call.startedAt, phone: call.phone };

    if (!opts.dryRun && !(await claim(call, now))) {
        return { ...head, decision: 'skipped', category: 'busy', reason: 'Звонок разбирает другой проход.' };
    }

    try {
        const managerId = await managerByExtension(call.managerExtension);

        const early = await skipBeforeAi(call);
        if (early) {
            const row: JournalRow = { decision: 'skipped', ...early, manager_id: managerId };
            if (!opts.dryRun) await writeJournal(call.callId, row);
            return { ...head, ...row };
        }

        const verdict = await classifyCall(call.transcript);
        const why = `${verdict.reason} (уверенность ${Math.round(verdict.confidence * 100)}%)`;

        if (!verdict.createOrder) {
            const row: JournalRow = {
                decision: 'skipped',
                category: verdict.category,
                reason: why,
                summary: verdict.summary || null,
                manager_id: managerId,
                model: verdict.model,
            };
            if (!opts.dryRun) await writeJournal(call.callId, row);
            return { ...head, ...row };
        }

        // Тот же запрос уже заведён — по письму, с сайта или менеджером с другим
        // телефоном. В пробном прогоне смотрим заказы до момента, когда крон
        // разобрал бы звонок, — как это было бы вживую.
        const until = opts.dryRun && opts.waitMinutes != null
            ? new Date(Math.min(now.getTime(), new Date(call.startedAt).getTime() + opts.waitMinutes * 60_000))
            : now;
        const same = await matchExistingOrder(call, verdict, await recentOrdersAround(call, until));
        if (same) {
            if (!opts.dryRun) {
                // Связь — подсказкой: менеджер подтвердит, что звонок про этот заказ.
                await bindCallToOrder({
                    callId: call.callId,
                    orderId: same.order.id,
                    method: 'ai_suggested',
                    reason: `ИИ-РОП: звонок про этот заказ — ${same.reason}`,
                    suggested: true,
                });
            }
            const row: JournalRow = {
                decision: 'skipped',
                category: 'already_ordered',
                reason: `Тот же запрос уже заведён: заказ ${same.order.number}. ${same.reason}`,
                summary: verdict.summary,
                order_id: same.order.id,
                manager_id: managerId,
                model: verdict.model,
            };
            if (!opts.dryRun) await writeJournal(call.callId, row);
            return { ...head, ...row, orderNumber: same.order.number };
        }

        if (opts.dryRun) {
            return {
                ...head,
                decision: 'created',
                category: verdict.category,
                reason: why,
                summary: verdict.summary,
                manager_id: managerId,
                model: verdict.model,
            };
        }

        // Пока шёл разбор, менеджер мог завести заказ сам — проверяем ещё раз.
        const late = await skipBeforeAi(call);
        if (late) {
            const row: JournalRow = { decision: 'skipped', ...late, manager_id: managerId, model: verdict.model };
            await writeJournal(call.callId, row);
            return { ...head, ...row };
        }

        const created = await createCallLead({
            phone: call.phone,
            managerId,
            callStartedAt: call.startedAt,
            summary: verdict.summary,
            clientName: verdict.clientName,
            company: verdict.company,
        });

        await bindCallToOrder({
            callId: call.callId,
            orderId: created.id,
            method: 'okk_auto',
            reason: 'Заказ завёл ИИ-РОП по этому звонку',
        });

        const row: JournalRow = {
            decision: 'created',
            category: verdict.category,
            reason: why,
            summary: verdict.summary,
            order_id: created.id,
            manager_id: created.managerId,
            model: verdict.model,
        };
        await writeJournal(call.callId, row);
        return { ...head, ...row, orderNumber: created.number };
    } catch (e: any) {
        const row: JournalRow = { decision: 'error', reason: String(e?.message || e).slice(0, 500) };
        if (!opts.dryRun) await writeJournal(call.callId, row);
        return { ...head, ...row };
    }
}

export async function runCallLeadReview(opts: { now?: Date; dryRun?: boolean; force?: boolean } = {}) {
    const now = opts.now ?? new Date();
    const settings = await loadCallLeadSettings();
    if (!settings.enabled && !opts.force) {
        return { ok: true, status: 'disabled' as const, decisions: [] as CallDecision[] };
    }

    const calls = await findCandidateCalls(settings, now);
    const decisions: CallDecision[] = [];
    // По одному: две ноги одного разговора иначе заведут два заказа.
    for (const call of calls) {
        decisions.push(await reviewCall(call, { dryRun: opts.dryRun, now, waitMinutes: settings.waitMinutes }));
    }
    return { ok: true, status: 'done' as const, decisions };
}
