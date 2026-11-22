// Логика AI-секретаря: поиск заказа по номеру, определение «чей клиент» по номеру
// звонящего и проверка, можно ли перевести звонок на менеджера.
// Кому отдать НОВУЮ заявку, здесь не решаем: это общее правило всех потоков
// (`assignManagerForNewOrder`), его вызывает `createSecretaryLead`.
import { supabase } from '@/utils/supabase';
import { findOrdersByPhone } from '@/lib/orders-by-phone';

export interface FoundOrder {
    id: number;
    number: string | null;
    manager_id: number | null;
    status: string | null;
    phone: string | null;
}

/** На кого можно перевести звонок: живой менеджер с добавочным и галочкой «принимает перевод». */
export interface TransferTarget {
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

export interface CallerOwner extends TransferTarget {
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

function asTarget(m: any): TransferTarget | null {
    if (!m || !isTransferTarget(m)) return null;
    return {
        id: Number(m.id),
        name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
        extension: String(m.telphin_extension).trim(),
    };
}

function managerAsTarget(m: any, by: CallerOwner['by']): CallerOwner | null {
    const target = asTarget(m);
    return target ? { ...target, by } : null;
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
 * живой источник номеров — сами заказы. Сам поиск общий на всю систему
 * (`lib/orders-by-phone.ts`): по хвосту из семи цифр, что переживает +7/8,
 * добавочные и разделители.
 * Возвращаем только того, на кого разрешён перевод; иначе null — звонок идёт в очередь ОП.
 */
export async function findOwnerByCallerPhone(phone: string): Promise<CallerOwner | null> {
    const orders = await findOrdersByPhone(phone, {
        columns: 'id, manager_id, customer, created_at',
        limit: 10,
    });

    const rows = orders as Array<{ manager_id: number | null; customer: { id?: number } | null }>;
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
 * Можно ли перевести звонок на этого менеджера, и куда. Те же условия, что у
 * ветки by_caller: активен, есть добавочный, стоит галочка «принимает перевод»
 * в /settings/managers. Нельзя — null, звонок уходит в очередь ОП.
 */
export async function transferTargetById(id: number | null | undefined): Promise<TransferTarget | null> {
    return asTarget(await managerRow(id));
}
