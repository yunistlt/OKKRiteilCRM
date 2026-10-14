// Логика AI-секретаря: поиск заказа по номеру, определение «чей клиент» по номеру
// звонящего и распределение нового заказа по нагрузке.
import { supabase } from '@/utils/supabase';
import { normalizePhone } from '@/lib/phone-utils';

export interface FoundOrder {
    id: number;
    number: string | null;
    manager_id: number | null;
    status: string | null;
    phone: string | null;
}

export interface PickedManager {
    id: number;
    name: string;
    extension: string;
}

/** Найти заказ по его номеру RetailCRM (orders.number — текст; номер приходит донабором DTMF). */
export async function findOrderByNumber(num: string): Promise<FoundOrder | null> {
    const clean = (num || '').trim();
    if (!clean) return null;
    const { data } = await supabase
        .from('orders')
        .select('id, number, manager_id, status, phone')
        .eq('number', clean)
        .maybeSingle();
    return (data as FoundOrder) || null;
}

/** Менеджер по id (для имени и добавочного при переводе на «текущий заказ»). */
export async function getManagerById(id: number) {
    const { data } = await supabase
        .from('managers')
        .select('id, first_name, last_name, telphin_extension')
        .eq('id', id)
        .maybeSingle();
    return data as { id: number; first_name: string | null; last_name: string | null; telphin_extension: string | null } | null;
}

export interface CallerOwner {
    id: number;
    name: string;
    extension: string;
    /** Откуда узнали хозяина: карточка клиента или последний заказ по этому номеру. */
    by: 'client' | 'order';
}

/** Можно ли переводить звонок на этого человека: решает настройка, а не список в коде. */
function isTransferTarget(m: {
    active?: boolean | null;
    accepts_call_transfer?: boolean | null;
    telphin_extension?: string | null;
}): boolean {
    return Boolean(m.active && m.accepts_call_transfer && String(m.telphin_extension || '').trim());
}

function managerAsTarget(m: any, by: CallerOwner['by']): CallerOwner | null {
    if (!m || !isTransferTarget(m)) return null;
    return {
        id: Number(m.id),
        name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
        extension: String(m.telphin_extension).trim(),
        by,
    };
}

async function managerRow(id: number | null | undefined) {
    if (!id) return null;
    const { data } = await supabase
        .from('managers')
        .select('id, first_name, last_name, telphin_extension, active, accepts_call_transfer')
        .eq('id', id)
        .maybeSingle();
    return data as any;
}

/**
 * Чей клиент звонит. Порядок — владелец карточки клиента, затем менеджер последнего
 * заказа по этому номеру (закон «раздаём клиентами»: хозяин карточки главнее).
 * Телефон ищем в заказах: clients.phones заполнена у сотни карточек из двадцати тысяч,
 * живой источник номеров — сами заказы. Сравниваем по последним 7 цифрам, как в
 * lib/call-matching.ts, — это переживает +7/8 и добавочные в хвосте.
 * Возвращаем только того, на кого разрешён перевод; иначе null — звонок идёт в очередь ОП.
 */
export async function findOwnerByCallerPhone(phone: string): Promise<CallerOwner | null> {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    const suffix = normalized.slice(-7);
    if (suffix.length < 7) return null;

    const { data: orders } = await supabase
        .from('orders')
        .select('id, manager_id, customer, created_at')
        .or(`phone.ilike.%${suffix}%,raw_payload->>additionalPhone.ilike.%${suffix}%`)
        .order('created_at', { ascending: false })
        .limit(10);

    const rows = (orders || []) as Array<{ manager_id: number | null; customer: { id?: number } | null }>;
    if (!rows.length) return null;

    // 1. Владелец карточки клиента последнего заказа.
    for (const row of rows) {
        const clientId = row.customer?.id;
        if (!clientId) continue;
        const { data: client } = await supabase
            .from('clients')
            .select('id, manager_id, merged_into')
            .eq('id', clientId)
            .maybeSingle();
        const ownerId = (client as any)?.manager_id;
        if (!ownerId) continue;
        const target = managerAsTarget(await managerRow(Number(ownerId)), 'client');
        if (target) return target;
        break; // хозяин есть, но перевод на него запрещён — в очередь, не ищем «похожего»
    }

    // 2. Менеджер последнего заказа по этому номеру.
    for (const row of rows) {
        const target = managerAsTarget(await managerRow(row.manager_id), 'order');
        if (target) return target;
    }

    return null;
}

/**
 * Выбрать наименее загруженного менеджера для новой заявки.
 * Кандидаты: активные менеджеры с заданным добавочным Телфина.
 * Нагрузка = число заказов в рабочих статусах (status_settings.is_working).
 * Тай-брейк — выше рейтинг. Менеджеры на пределе (>= max_load) пропускаются.
 */
export async function pickLeastLoadedManager(): Promise<PickedManager | null> {
    const { data: workingSettings } = await supabase
        .from('status_settings')
        .select('code')
        .eq('is_working', true);
    const workingCodes = (workingSettings || []).map((s: { code: string }) => s.code);

    const { data: managers } = await supabase
        .from('managers')
        .select('id, first_name, last_name, telphin_extension, max_load, rating, active');

    const candidates = (managers || []).filter(
        (m: { active?: boolean; telphin_extension?: string | null }) =>
            m.active && m.telphin_extension && String(m.telphin_extension).trim(),
    );
    if (!candidates.length) return null;

    let best: any = null;
    let bestLoad = Infinity;

    for (const m of candidates) {
        let load = 0;
        if (workingCodes.length) {
            const { count } = await supabase
                .from('orders')
                .select('id', { count: 'exact', head: true })
                .eq('manager_id', m.id)
                .in('status', workingCodes);
            load = count || 0;
        }
        const max = m.max_load || 20;
        if (load >= max) continue;

        const better = load < bestLoad || (load === bestLoad && (m.rating || 0) > (best?.rating || 0));
        if (better) {
            best = m;
            bestLoad = load;
        }
    }

    if (!best) return null;
    return {
        id: best.id,
        name: `${best.first_name || ''} ${best.last_name || ''}`.trim(),
        extension: String(best.telphin_extension).trim(),
    };
}
