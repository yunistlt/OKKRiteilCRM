import { supabase } from '@/utils/supabase';
import { findOrdersByPhone } from '@/lib/orders-by-phone';

/**
 * Клиент сказал, что потребности нет.
 *
 * До этого снять задачу было нечем. Задача по клиенту из блока «Развитие» уходит
 * только когда сдвинется дата следующего контакта, а сдвинуть её было некому:
 * заказа у такого клиента нет, а менеджер планом не управляет. Поэтому задача
 * возвращалась каждое утро, даже когда отказ был сказан вслух (доработка №77,
 * жалоба Ирины Гордеевой: «клиент сказал, что нет потребности в нашей
 * продукции, уберите эту задачу»).
 *
 * Решение принимает РОП, а не менеджер: он и так читает расшифровки вечером.
 * Услышал отказ — сам ставит дату следующего контакта. Ошибся — правим его
 * инструкцию, а не даём людям кнопку в обход.
 */

/** На сколько откладываем. Слова клиента, а не наша догадка. */
export type RefusalHorizon = 'season' | 'year' | 'never';

export type Refusal = {
    /** Заказ, в разговоре по которому прозвучал отказ. */
    orderNumber: string | null;
    /** Номер звонившего — когда заказа в разговоре не было. */
    phone: string | null;
    horizon: RefusalHorizon;
    /** Слова клиента: по ним человек проверяет решение бота. */
    words: string;
};

export type AppliedRefusal = Refusal & {
    clientKey: string;
    clientName: string;
    /** Дата, с которой клиент снова попадёт в план. Null — отложен без даты. */
    nextContactAt: string | null;
    muted: boolean;
    /** Почему решение не применилось: клиента не нашли, дата уже дальше. */
    skipped: string | null;
};

const HORIZONS: Record<string, RefusalHorizon> = {
    сезон: 'season',
    год: 'year',
    никогда: 'never',
};

/**
 * Разобрать ответ модели.
 *
 * Разбор дня остаётся текстом для человека, а решения модель дописывает в конец
 * машинной строкой. Отдельным запросом это стоило бы второго вызова на каждого
 * менеджера каждый вечер — за те же деньги мы получаем и текст, и решения.
 *
 * Строки может не быть вовсе (старая инструкция, модель забыла, сбой разбора) —
 * это не ошибка: тогда отказов просто нет, а вечерний отчёт выходит как раньше.
 */
export function parseRefusals(answer: string): { text: string; refusals: Refusal[] } {
    const lines = answer.split('\n');
    const at = lines.findIndex((l) => /^\s*ОТКАЗЫ\s*:/i.test(l));
    if (at < 0) return { text: answer.trim(), refusals: [] };

    const text = lines.slice(0, at).join('\n').trim();
    const raw = lines.slice(at).join('\n').replace(/^\s*ОТКАЗЫ\s*:/i, '').trim();

    let parsed: unknown = null;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // «ОТКАЗЫ: нет» и любая другая человеческая формулировка — это «нечего
        // применять», а не повод потерять разбор дня.
        return { text, refusals: [] };
    }
    if (!Array.isArray(parsed)) return { text, refusals: [] };

    const refusals: Refusal[] = [];
    for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const words = String(o['слова'] ?? '').trim();
        // Без слов клиента решение непроверяемо, а значит и неприменимо.
        if (!words) continue;
        const order = String(o['заказ'] ?? '').trim();
        const phone = String(o['телефон'] ?? '').trim();
        if (!order && !phone) continue;
        refusals.push({
            orderNumber: order || null,
            phone: phone || null,
            // Непонятное слово — самая короткая отсрочка: вернуть клиента рано
            // не страшно, а похоронить на год по ошибке разбора — страшно.
            horizon: HORIZONS[String(o['горизонт'] ?? '').trim().toLowerCase()] ?? 'season',
            words,
        });
    }
    return { text, refusals };
}

/** Через сколько дней вернуть клиента в план. */
function daysFor(horizon: RefusalHorizon, seasonDays: number, yearDays: number): number {
    if (horizon === 'season') return seasonDays;
    return yearDays;
}

function plusDays(today: string, days: number): string {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/** Ключ клиента — тот же, что в снимке отношений: ИНН, иначе номер карточки. */
async function clientKeysFor(orderNumbers: string[]): Promise<Map<string, string>> {
    const byOrder = new Map<string, string>();
    if (orderNumbers.length === 0) return byOrder;

    const { data: orders } = await supabase
        .from('orders')
        .select('number, raw_payload')
        .in('number', orderNumbers);

    const custByOrder = new Map<string, string>();
    for (const o of (orders ?? []) as any[]) {
        const cust = o?.raw_payload?.customer?.id;
        if (cust) custByOrder.set(String(o.number), String(cust));
    }
    if (custByOrder.size === 0) return byOrder;

    const { data: clients } = await supabase
        .from('clients')
        .select('id, inn')
        .in('id', Array.from(new Set(Array.from(custByOrder.values()))));

    const innById = new Map<string, string>();
    for (const c of (clients ?? []) as any[]) {
        const inn = String(c?.inn ?? '').trim();
        if (inn) innById.set(String(c.id), inn);
    }

    for (const [number, cust] of Array.from(custByOrder.entries())) {
        byOrder.set(number, innById.get(cust) ?? `cust:${cust}`);
    }
    return byOrder;
}

/**
 * Поставить дату следующего контакта по услышанным отказам.
 *
 * Дату назад не сдвигаем никогда: если в отношениях уже стоит более дальняя
 * дата, значит кто-то уже решил позже нашего — закон о неприкосновенной дате
 * контакта сильнее сегодняшнего разбора.
 */
export async function applyRefusals(params: {
    refusals: Refusal[];
    today: string;
    seasonDays: number;
    yearDays: number;
    dryRun?: boolean;
}): Promise<AppliedRefusal[]> {
    const { refusals, today, seasonDays, yearDays } = params;
    if (refusals.length === 0) return [];

    // Отказ без номера заказа ищем по телефону — тем же хвостом из семи цифр,
    // которым живёт весь поиск заказа по номеру (доработка №75).
    const resolved: Array<Refusal & { orderNumber: string | null }> = [];
    for (const r of refusals) {
        if (r.orderNumber) {
            resolved.push(r);
            continue;
        }
        const orders = r.phone
            ? await findOrdersByPhone(r.phone, { columns: 'number', limit: 1 }).catch(() => [])
            : [];
        resolved.push({ ...r, orderNumber: orders.length > 0 ? String(orders[0].number) : null });
    }

    const keys = await clientKeysFor(
        Array.from(new Set(resolved.map((r) => r.orderNumber).filter((x): x is string => Boolean(x)))),
    );

    const { data: rows } = await supabase
        .from('sales_client_relation')
        .select('client_key, client_name, next_contact_at, muted')
        .in('client_key', Array.from(new Set(Array.from(keys.values()))));
    const relation = new Map<string, any>(((rows ?? []) as any[]).map((r) => [String(r.client_key), r]));

    const applied: AppliedRefusal[] = [];
    for (const r of resolved) {
        const key = r.orderNumber ? keys.get(r.orderNumber) : undefined;
        const row = key ? relation.get(key) : undefined;
        if (!key || !row) {
            applied.push({
                ...r,
                clientKey: key ?? '',
                clientName: '',
                nextContactAt: null,
                muted: false,
                skipped: 'клиента не нашли',
            });
            continue;
        }

        const next = plusDays(today, daysFor(r.horizon, seasonDays, yearDays));
        const already = row.next_contact_at ? String(row.next_contact_at).slice(0, 10) : null;
        if (already && already >= next && !(r.horizon === 'never' && !row.muted)) {
            applied.push({
                ...r,
                clientKey: key,
                clientName: String(row.client_name ?? ''),
                nextContactAt: already,
                muted: Boolean(row.muted),
                skipped: 'дата уже дальше',
            });
            continue;
        }

        const patch: Record<string, unknown> = { next_contact_at: next };
        if (r.horizon === 'never') {
            // «Никогда» — не удаление клиента, а снятие его с ритма: в план он
            // больше не приходит, но карточка и причина остаются на виду.
            patch.muted = true;
            patch.muted_reason = `нет потребности: «${r.words}» (сказано ${today})`;
        }
        if (!params.dryRun) {
            await supabase.from('sales_client_relation').update(patch).eq('client_key', key);
        }
        applied.push({
            ...r,
            clientKey: key,
            clientName: String(row.client_name ?? ''),
            nextContactAt: next,
            muted: r.horizon === 'never',
            skipped: null,
        });
    }
    return applied;
}

const RU_DATE = (iso: string) => iso.split('-').reverse().join('.');

/** Строка в разбор вечера: что бот решил и по чьим словам. */
export function formatRefusals(applied: AppliedRefusal[]): string {
    if (applied.length === 0) return '';
    const lines = ['Отказы в разговорах:'];
    for (const a of applied) {
        const who = a.clientName || (a.orderNumber ? `заказ №${a.orderNumber}` : a.phone) || 'клиент';
        const order = a.clientName && a.orderNumber ? ` (заказ №${a.orderNumber})` : '';
        if (a.skipped) {
            lines.push(`• ${who}${order} — «${a.words}». Не отложил: ${a.skipped}.`);
            continue;
        }
        lines.push(
            a.muted
                ? `• ${who}${order} — «${a.words}». Снял с ритма, в план больше не ставлю.`
                : `• ${who}${order} — «${a.words}». Вернусь ${RU_DATE(a.nextContactAt as string)}.`,
        );
    }
    return lines.join('\n');
}
