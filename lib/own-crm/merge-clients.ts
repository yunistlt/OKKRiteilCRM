/**
 * Слияние карточек одного юрлица.
 *
 * Закон владельца 09.10.2026: одно юрлицо — одна карточка. Опора — `clients.id`
 * (он есть у всех, включая иностранцев без ИНН), а ИНН уникален там, где он
 * заполнен, и просто запрещает дубли.
 *
 * Откуда дубли: автоприём заводил карточку, пока ИНН в письме ещё не был
 * известен, а позже тот же ИНН находился в давней карточке RetailCRM. У «ООО
 * ТД „Пищевые технологии"» так набралось семь карточек, и менеджер не мог
 * внести ИНН в ту, в которой работал.
 *
 * Карточку-дубль НЕ удаляем: на неё ссылаются старые документы и выгрузки.
 * Помечаем `merged_into` — после этого она не показывается в списке, а при
 * открытии ведёт на главную.
 */
import { supabase } from '@/utils/supabase';

export type MergeResult = {
    mainId: string;
    mergedId: string;
    /** Сколько заказов переехало на главную карточку. */
    movedOrders: number;
    /** Сколько контактных лиц переехало. */
    movedContacts: number;
};

/** Данные карточки, нужные для решения «кто главный». */
type Card = { id: string; company_name: string | null; ordersHere: number };

async function card(id: string): Promise<Card | null> {
    const { data } = await supabase
        .from('clients')
        .select('id, company_name, merged_into')
        .eq('id', id)
        .maybeSingle();

    if (!data) return null;
    if ((data as any).merged_into) {
        throw new Error(`Карточка №${id} уже слита с №${(data as any).merged_into}`);
    }

    const { count } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .filter('customer->>id', 'eq', id);

    return { id: String((data as any).id), company_name: (data as any).company_name ?? null, ordersHere: Number(count ?? 0) };
}

/**
 * Слить карточку `dupId` в `mainId`.
 *
 * Переносим заказы и контактных лиц, дополняем пустые реквизиты главной тем,
 * что было в дубле (их вносил человек — терять нельзя), и помечаем дубль.
 */
export async function mergeClients(mainId: string | number, dupId: string | number, actor?: string | null): Promise<MergeResult> {
    const main = String(mainId);
    const dup = String(dupId);

    if (main === dup) throw new Error('Это одна и та же карточка');

    const [mainCard, dupCard] = await Promise.all([card(main), card(dup)]);
    if (!mainCard) throw new Error(`Карточка №${main} не найдена`);
    if (!dupCard) throw new Error(`Карточка №${dup} не найдена`);

    // Заказы: клиент у заказа живёт в `customer->>id` и в `raw_payload`
    // (закон «клиент из raw_payload->customer->id»), держим их в согласии.
    const { data: orders } = await supabase
        .from('orders')
        .select('id, customer, raw_payload')
        .filter('customer->>id', 'eq', dup);

    let movedOrders = 0;
    for (const row of ((orders ?? []) as any[])) {
        const customer = { ...(row.customer || {}), id: Number(main) };
        const payload = { ...(row.raw_payload || {}) };
        payload.customer = { ...(payload.customer || {}), id: Number(main) };

        const { error } = await supabase.from('orders').update({ customer, raw_payload: payload }).eq('id', row.id);
        if (!error) movedOrders += 1;
    }

    // Контактные лица: люди компании должны оказаться в одной карточке.
    const { data: contacts } = await supabase.from('client_contacts').select('id').eq('client_id', dup);
    let movedContacts = 0;
    if ((contacts ?? []).length) {
        const { error } = await supabase.from('client_contacts').update({ client_id: Number(main) }).eq('client_id', dup);
        if (!error) movedContacts = (contacts as any[]).length;
    }

    // Реквизиты: берём из дубля только то, чего у главной нет.
    const FIELDS = [
        'inn', 'kpp', 'OGRN', 'OGRNIP', 'legalName', 'legalAddress', 'full_name',
        'signer_name', 'signer_title', 'signer_basis',
        'bank', 'bankAccount', 'BIK', 'corrAccount', 'bankAddress',
        'email', 'contact_email',
    ] as const;

    const columns = FIELDS.map((f) => (/[A-Z]/.test(f) ? `"${f}"` : f)).join(', ');
    const [{ data: mainRow }, { data: dupRow }] = await Promise.all([
        supabase.from('clients').select(`${columns}, phones`).eq('id', main).maybeSingle(),
        supabase.from('clients').select(`${columns}, phones`).eq('id', dup).maybeSingle(),
    ]);

    const patch: Record<string, unknown> = {};
    for (const field of FIELDS) {
        const mine = String((mainRow as any)?.[field] ?? '').trim();
        const theirs = String((dupRow as any)?.[field] ?? '').trim();
        if (!mine && theirs) patch[field] = theirs;
    }

    const mainPhones: string[] = ((mainRow as any)?.phones ?? []) as string[];
    const dupPhones: string[] = ((dupRow as any)?.phones ?? []) as string[];
    if (dupPhones?.length) {
        // Телефоны складываем: приёмная одной карточки и снабжение другой —
        // это телефоны одной компании.
        const all = Array.from(new Set([...(mainPhones ?? []), ...dupPhones].filter(Boolean).map(String)));
        if (all.length !== (mainPhones ?? []).length) patch.phones = all;
    }

    /**
     * Сначала помечаем дубль слитым и снимаем с него ИНН — и только потом
     * переносим реквизиты в главную.
     *
     * Порядок важен: уникальный индекс по ИНН считает только неслитые
     * карточки. Пока дубль «живой», запись его ИНН в главную отклоняется — и
     * при слиянии «Пищевых технологий» (09.10.2026) ИНН так и не доехал:
     * ошибку никто не проверял, слияние отчиталось успехом, а компания
     * осталась без ИНН вообще.
     */
    const { error: markError } = await supabase
        .from('clients')
        .update({ merged_into: Number(main), inn: null, updated_at: new Date().toISOString() })
        .eq('id', dup);

    if (markError) throw new Error(`Карточка не пометилась слитой: ${markError.message}`);

    if (Object.keys(patch).length) {
        patch.updated_at = new Date().toISOString();
        if (actor) {
            patch.requisites_updated_by = actor;
            patch.requisites_updated_at = new Date().toISOString();
        }
        const { error } = await supabase.from('clients').update(patch).eq('id', main);
        // Молчать нельзя: иначе главная остаётся без реквизитов дубля, а дубль
        // уже слит — данные некуда возвращать.
        if (error) throw new Error(`Реквизиты не перенеслись в главную карточку: ${error.message}`);
    }

    return { mainId: main, mergedId: dup, movedOrders, movedContacts };
}
