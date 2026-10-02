/**
 * Реквизиты заказчика: принадлежат КЛИЕНТУ, в заказ подтягиваются.
 *
 * Решение владельца 02.10.2026: «реквизиты заказчика не могут быть атрибутом
 * заказа, это атрибуты заказчика; в заказ они подтягиваются из карточки
 * клиента». RetailCRM держит их на заказе — поэтому старые реквизиты мы оттуда
 * и забираем (`fromOrderNumber`), но дальше живут они у клиента.
 */
import { supabase } from '@/utils/supabase';

export type Requisites = {
    contragentType: string | null;
    legalName: string | null;
    inn: string | null;
    kpp: string | null;
    ogrn: string | null;
    ogrnip: string | null;
    legalAddress: string | null;
    bank: string | null;
    bankAccount: string | null;
    bik: string | null;
    corrAccount: string | null;
    bankAddress: string | null;
};

export type ClientRequisitesCard = Requisites & {
    /** Откуда взяты: карточка клиента или последний заказ с реквизитами. */
    source: 'client' | 'order' | 'none';
    /** Номер заказа, если реквизиты ещё не перенесены в карточку. */
    fromOrderNumber: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
};

const EMPTY: Requisites = {
    contragentType: null, legalName: null, inn: null, kpp: null, ogrn: null, ogrnip: null,
    legalAddress: null, bank: null, bankAccount: null, bik: null, corrAccount: null, bankAddress: null,
};

const text = (value: unknown): string | null => {
    const result = String(value ?? '').trim();
    return result || null;
};

/** Реквизиты из заказа (формат RetailCRM `contragent`) в наши поля. */
export function fromOrderContragent(contragent: any): Requisites {
    const c = contragent || {};
    return {
        contragentType: text(c.contragentType),
        legalName: text(c.legalName),
        inn: text(c.INN),
        kpp: text(c.KPP),
        ogrn: text(c.OGRN),
        ogrnip: text(c.OGRNIP),
        legalAddress: text(c.legalAddress),
        bank: text(c.bank),
        bankAccount: text(c.bankAccount),
        bik: text(c.BIK),
        corrAccount: text(c.corrAccount),
        bankAddress: text(c.bankAddress),
    };
}

/** Наши поля обратно в формат RetailCRM — его ждут заказ, счёт и КП. */
export function toOrderContragent(requisites: Partial<Requisites>): Record<string, string> {
    const map: Array<[keyof Requisites, string]> = [
        ['contragentType', 'contragentType'],
        ['legalName', 'legalName'],
        ['inn', 'INN'],
        ['kpp', 'KPP'],
        ['ogrn', 'OGRN'],
        ['ogrnip', 'OGRNIP'],
        ['legalAddress', 'legalAddress'],
        ['bank', 'bank'],
        ['bankAccount', 'bankAccount'],
        ['bik', 'BIK'],
        ['corrAccount', 'corrAccount'],
        ['bankAddress', 'bankAddress'],
    ];

    const out: Record<string, string> = {};
    for (const [ours, theirs] of map) {
        const value = text((requisites as any)[ours]);
        if (value) out[theirs] = value;
    }
    return out;
}

function rowToRequisites(row: any): Requisites {
    return {
        contragentType: text(row.contragent_type),
        legalName: text(row.legal_name),
        inn: text(row.inn),
        kpp: text(row.kpp),
        ogrn: text(row.ogrn),
        ogrnip: text(row.ogrnip),
        legalAddress: text(row.legal_address),
        bank: text(row.bank),
        bankAccount: text(row.bank_account),
        bik: text(row.bik),
        corrAccount: text(row.corr_account),
        bankAddress: text(row.bank_address),
    };
}

/**
 * Реквизиты клиента. Пока их не внесли в карточку — показываем те, что лежат
 * в его последнем заказе, и честно говорим, откуда они (закон «цифры
 * раскладываются»).
 */
export async function loadClientRequisites(clientId: number | string): Promise<ClientRequisitesCard> {
    const id = String(clientId ?? '').trim();
    if (!id) return { ...EMPTY, source: 'none', fromOrderNumber: null, updatedAt: null, updatedBy: null };

    const { data: saved } = await supabase
        .from('client_requisites')
        .select('*')
        .eq('client_id', id)
        .eq('is_primary', true)
        .maybeSingle();

    if (saved) {
        return {
            ...rowToRequisites(saved),
            source: 'client',
            fromOrderNumber: null,
            updatedAt: (saved as any).updated_at ?? null,
            updatedBy: (saved as any).updated_by ?? null,
        };
    }

    const { data: orders } = await supabase
        .from('orders')
        .select('number, "contragent"')
        .filter('customer->>id', 'eq', id)
        .not('contragent->>INN', 'is', null)
        .order('createdAt', { ascending: false })
        .limit(1);

    const last = (orders || [])[0] as any;
    if (last?.contragent) {
        return {
            ...fromOrderContragent(last.contragent),
            source: 'order',
            fromOrderNumber: text(last.number),
            updatedAt: null,
            updatedBy: null,
        };
    }

    return { ...EMPTY, source: 'none', fromOrderNumber: null, updatedAt: null, updatedBy: null };
}

/** Сохранить основные реквизиты клиента. */
export async function saveClientRequisites(
    clientId: number | string,
    requisites: Partial<Requisites>,
    actor?: string | null,
): Promise<void> {
    const id = Number(clientId);
    if (!Number.isFinite(id)) throw new Error('Не понял, какому клиенту сохранять реквизиты');

    const row = {
        client_id: id,
        is_primary: true,
        contragent_type: text(requisites.contragentType),
        legal_name: text(requisites.legalName),
        inn: text(requisites.inn),
        kpp: text(requisites.kpp),
        ogrn: text(requisites.ogrn),
        ogrnip: text(requisites.ogrnip),
        legal_address: text(requisites.legalAddress),
        bank: text(requisites.bank),
        bank_account: text(requisites.bankAccount),
        bik: text(requisites.bik),
        corr_account: text(requisites.corrAccount),
        bank_address: text(requisites.bankAddress),
        updated_by: text(actor),
        updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
        .from('client_requisites')
        .select('id')
        .eq('client_id', id)
        .eq('is_primary', true)
        .maybeSingle();

    const { error } = existing
        ? await supabase.from('client_requisites').update(row).eq('id', (existing as any).id)
        : await supabase.from('client_requisites').insert(row);

    if (error) throw new Error(`Не удалось сохранить реквизиты: ${error.message}`);
}
