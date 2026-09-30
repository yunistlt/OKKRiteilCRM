/**
 * Документы по заказу: коммерческое предложение и счёт на оплату.
 *
 * Состав берём из позиций заказа (`order_items`), плательщика — из контрагента
 * заказа, продавца — из реквизитов магазина в RetailCRM. Ничего не выдумываем и
 * не хардкодим: у магазина в справочнике заполнены юрлицо, ИНН, КПП, банк и
 * счета, и это тот же продавец, от чьего имени работает заказ.
 */
import { supabase } from '@/utils/supabase';
import { getCrmConfig } from '@/lib/retailcrm/leads';

export type DocumentItem = {
    name: string;
    quantity: number;
    price: number;
};

export type Seller = {
    name: string;
    inn: string;
    kpp: string;
    bank: string;
    bik: string;
    ks: string;
    rs: string;
    address: string;
};

export type SellerOption = { code: string; name: string };

export type OrderDocumentData = {
    orderNumber: string;
    /** Ставка НДС по факту позиций заказа, а не выдуманная. */
    vatPercent: number;
    /** От каких юрлиц можно выставить счёт. */
    sellerOptions: SellerOption[];
    items: DocumentItem[];
    payerCompany: string | null;
    payerName: string | null;
    payerInn: string | null;
    payerKpp: string | null;
    payerAddress: string | null;
    seller: Seller | null;
    total: number;
};

let sitesCache: { at: number; value: Record<string, any> } | null = null;

/** Реквизиты магазинов из RetailCRM. Кэш на десять минут — справочник меняется редко. */
async function siteDirectory(): Promise<Record<string, any>> {
    if (sitesCache && Date.now() - sitesCache.at < 10 * 60 * 1000) {
        return sitesCache.value;
    }

    const { url, key } = await getCrmConfig();
    const response = await fetch(`${url}/api/v5/reference/sites?apiKey=${key}`);
    const payload = await response.json();
    const value = payload?.sites || {};
    sitesCache = { at: Date.now(), value };
    return value;
}

/** Продавец по магазину заказа. Магазина нет в справочнике — вернём null, а не выдумку. */
export async function sellerFromSite(siteCode: string | null | undefined): Promise<Seller | null> {
    if (!siteCode) {
        return null;
    }

    const sites = await siteDirectory().catch(() => ({}));
    const site = (sites as any)[siteCode];
    const contragent = site?.contragent;
    if (!contragent) {
        return null;
    }

    return {
        name: contragent.legalName || site?.name || '',
        inn: contragent.INN || '',
        kpp: contragent.KPP || '',
        bank: contragent.bank || '',
        bik: contragent.BIK || '',
        ks: contragent.corrAccount || '',
        rs: contragent.bankAccount || '',
        address: contragent.legalAddress || site?.address || '',
    };
}

/** Все наши юрлица — это магазины в RetailCRM, у каждого свои реквизиты. */
export async function sellerOptions(): Promise<SellerOption[]> {
    const sites = await siteDirectory().catch(() => ({}));
    return Object.entries(sites as Record<string, any>)
        .filter(([, site]) => site?.contragent?.legalName)
        .map(([code, site]) => ({ code, name: site.contragent.legalName || site.name || code }));
}

/**
 * Ставка НДС берётся из карточки нашего юрлица — её задаёт человек в настройках
 * (`/settings/legal-entities`). В коде её нет и быть не должно: у ИП и у ООО
 * она разная и меняется решением, а не выкаткой.
 *
 * Не задана — считаем, что НДС нет: выдумывать ставку для счёта нельзя.
 */
export async function vatPercentForSite(siteCode: string | null | undefined): Promise<number> {
    if (!siteCode) {
        return 0;
    }

    const { data } = await supabase
        .from('legal_entities')
        .select('vat_percent')
        .eq('site_code', siteCode)
        .maybeSingle();

    const rate = Number((data as any)?.vat_percent);
    return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

/** Данные для КП и счёта по заказу. */
export async function orderDocumentData(orderId: number, sellerCode?: string | null): Promise<OrderDocumentData | null> {
    const { data: order } = await supabase
        .from('orders')
        .select('order_id, number, site, "contragent", "customer", "firstName", "lastName"')
        .eq('id', orderId)
        .maybeSingle();

    if (!order) {
        return null;
    }

    const crmOrderId = (order as any).order_id ?? orderId;
    const { data: rows } = await supabase
        .from('order_items')
        .select('"offer", "quantity", "initialPrice", "discountTotal", "vatRate"')
        .eq('order_id', crmOrderId)
        .order('ordering', { ascending: true });

    const items: DocumentItem[] = (rows || []).map((row: any) => ({
        name: row.offer?.displayName || row.offer?.name || 'Позиция',
        quantity: Number(row.quantity || 0),
        // Цена за единицу с учётом скидки по позиции — то, что клиент увидит в счёте.
        price: Math.max(0, Number(row.initialPrice || 0) - (Number(row.quantity || 0) > 0
            ? Number(row.discountTotal || 0) / Number(row.quantity)
            : 0)),
    }));

    const contragent = (order as any).contragent || {};
    const customer = (order as any).customer || {};

    return {
        orderNumber: String((order as any).number || crmOrderId),
        items,
        payerCompany: contragent.legalName || customer.nickName || null,
        payerName: [(order as any).lastName, (order as any).firstName].filter(Boolean).join(' ') || null,
        payerInn: contragent.INN || null,
        payerKpp: contragent.KPP || null,
        payerAddress: contragent.legalAddress || null,
        // Юрлицо: по умолчанию то, чьему магазину принадлежит заказ, но счёт
        // можно выставить и от другого — юрлиц у компании несколько.
        seller: await sellerFromSite(sellerCode || (order as any).site),
        sellerOptions: await sellerOptions(),
        vatPercent: await vatPercentForSite(sellerCode || (order as any).site),
        total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    };
}
