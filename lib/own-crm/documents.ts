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
import { loadClientRequisites } from './client-requisites';

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
    /** ОГРН — нужен для печати организации. */
    ogrn: string;
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
    /**
     * Срок изготовления в днях — «Срок изготовления в днях*» из заказа. Женя
     * 02.10.2026: «в счёте нет сроков производства».
     */
    productionDays: number | null;
    /**
     * Как клиент получает: название способа доставки из справочника RetailCRM
     * плюс адрес. При самовывозе адрес — это откуда забирать, и менеджер
     * вписывает его руками в заказе (решение владельца 02.10.2026).
     */
    shippingTerms: string | null;
    /** Кто подписывает счёт — из справочника наших юрлиц. */
    signerName: string | null;
    signerTitle: string | null;
    /** Менеджер заказа: вторая подпись в счёте (решение владельца 02.10.2026). */
    managerName: string | null;
    /** Полное наименование продавца и его адрес — для оттиска печати. */
    sellerFullName: string | null;
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
        ogrn: contragent.OGRN || contragent.OGRNIP || '',
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

/**
 * Заказ для документа. Ищем у себя по обоим номерам, а если заказ создан
 * минуту назад и ещё не приехал синхронизацией — берём его прямо из RetailCRM.
 * Иначе менеджер не может выставить КП сразу после создания заказа.
 */
async function loadOrderForDocument(orderKey: number) {
    for (const column of ['order_id', 'id'] as const) {
        const { data } = await supabase
            .from('orders')
            .select('id, order_id, number, site, "contragent", "customer", "firstName", "lastName", "delivery", manager_id, raw_payload')
            .eq(column, orderKey)
            .maybeSingle();

        if (data) {
            return { order: data as any, fresh: null as any };
        }
    }

    const { url, key } = await getCrmConfig();
    const response = await fetch(`${url}/api/v5/orders/${orderKey}?by=id&apiKey=${key}`);
    const payload = await response.json().catch(() => null);
    if (!payload?.order) {
        return null;
    }

    const fresh = payload.order;
    return {
        order: {
            order_id: fresh.id,
            number: fresh.number,
            site: fresh.site,
            contragent: fresh.contragent || {},
            customer: fresh.customer || {},
            firstName: fresh.firstName,
            lastName: fresh.lastName,
            delivery: fresh.delivery || {},
            customFields: fresh.customFields || {},
        },
        fresh,
    };
}

/** Данные для КП и счёта по заказу. */
export async function orderDocumentData(orderId: number, sellerCode?: string | null): Promise<OrderDocumentData | null> {
    const found = await loadOrderForDocument(orderId);
    if (!found) {
        return null;
    }

    const order = found.order;
    const crmOrderId = (order as any).order_id ?? orderId;

    let rows: any[] = [];
    if (found.fresh) {
        // Заказ взят прямо из RetailCRM — состав берём оттуда же.
        rows = (found.fresh.items || []).map((item: any) => ({
            offer: item.offer,
            quantity: item.quantity,
            initialPrice: item.initialPrice,
            discountTotal: item.discountTotal,
            vatRate: item.vatRate,
        }));
    } else {
        const { data } = await supabase
            .from('order_items')
            .select('"offer", "quantity", "initialPrice", "discountTotal", "vatRate"')
            .eq('order_id', crmOrderId)
            .order('ordering', { ascending: true });
        rows = data || [];
    }

    const items: DocumentItem[] = (rows || []).map((row: any) => ({
        name: row.offer?.displayName || row.offer?.name || row.productName || 'Позиция',
        quantity: Number(row.quantity || 0),
        // Цена за единицу с учётом скидки по позиции — то, что клиент увидит в счёте.
        price: Math.max(0, Number(row.initialPrice || 0) - (Number(row.quantity || 0) > 0
            ? Number(row.discountTotal || 0) / Number(row.quantity)
            : 0)),
    }));

    const contragent = (order as any).contragent || {};
    const customer = (order as any).customer || {};
    const delivery = (order as any).delivery || (order as any).raw_payload?.delivery || {};
    // Кастом-поля заказа лежат в raw_payload: своей колонки под них нет.
    const customFields = (order as any).customFields
        || (order as any).raw_payload?.customFields
        || {};

    /**
     * Реквизиты плательщика: в заказе их часто нет — хозяин реквизитов карточка
     * клиента (решение владельца 02.10.2026), а в заказе лежит один тип
     * контрагента. Женя 02.10.2026: «платёжные данные подтянулись из CRM
     * (постоянный заказчик), но в счёте они не отражены» — счёт читал только
     * заказ. Поэтому: сначала заказ, чего нет — из карточки клиента.
     */
    const clientRequisites = customer.id ? await loadClientRequisites(String(customer.id)) : null;
    const payerCompany = contragent.legalName || clientRequisites?.legalName || customer.nickName || null;
    const payerInn = contragent.INN || clientRequisites?.inn || null;
    const payerKpp = contragent.KPP || clientRequisites?.kpp || null;
    const payerAddress = contragent.legalAddress || clientRequisites?.legalAddress || null;

    const seller = await sellerFromSite(sellerCode || (order as any).site);

    return {
        orderNumber: String((order as any).number || crmOrderId),
        items,
        payerCompany,
        payerName: [(order as any).lastName, (order as any).firstName].filter(Boolean).join(' ') || null,
        payerInn,
        payerKpp,
        payerAddress,
        // Юрлицо: по умолчанию то, чьему магазину принадлежит заказ, но счёт
        // можно выставить и от другого — юрлиц у компании несколько.
        seller,
        sellerOptions: await sellerOptions(),
        vatPercent: await vatPercentForSite(sellerCode || (order as any).site),
        productionDays: Number(customFields.srok_izgot) > 0 ? Number(customFields.srok_izgot) : null,
        managerName: await managerNameOf((order as any).manager_id),
        sellerFullName: await sellerFullNameOf(seller),
        shippingTerms: await shippingTermsText(delivery),
        ...(await signerOf(sellerCode || (order as any).site, seller)),
        total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    };
}

/**
 * Условия получения человеческим языком: «Самовывоз, г. Тольятти, …» или
 * «Доставка Деловые Линии, адрес». Название способа — из справочника RetailCRM
 * (закон «имена из RetailCRM»), адрес — тот, что менеджер ввёл в заказе.
 */
async function shippingTermsText(delivery: any): Promise<string | null> {
    const code = String(delivery?.code ?? '').trim();
    const address = String(delivery?.address?.text ?? delivery?.address?.building ?? delivery?.address ?? '').trim();

    let name = '';
    if (code) {
        const { data } = await supabase
            .from('retailcrm_dictionaries')
            .select('item_name')
            .eq('entity_type', 'deliveryType')
            .eq('item_code', code)
            .maybeSingle();
        name = String((data as any)?.item_name ?? '').trim();
    }

    // Адрес менеджеры пишут свободным текстом, иногда с переносами и
    // заметками про габариты — в счёте это должно быть одной строкой.
    const oneLine = address
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);

    const parts = [name || null, oneLine && oneLine !== '[object Object]' ? oneLine : null].filter(Boolean);
    if (!parts.length) return null;
    return parts.join(', ');
}

/** Подписант счёта — из справочника наших юрлиц, по ИНН или коду магазина. */
async function signerOf(siteCode: string | null | undefined, seller: Seller | null): Promise<{ signerName: string | null; signerTitle: string | null }> {
    const inn = seller?.inn?.trim();
    const code = String(siteCode ?? '').trim();
    if (!inn && !code) return { signerName: null, signerTitle: null };

    const { data } = await supabase
        .from('legal_entities')
        .select('inn, site_code, signer_name, signer_title')
        .or([inn ? `inn.eq.${inn}` : null, code ? `site_code.eq.${code}` : null].filter(Boolean).join(','))
        .limit(1)
        .maybeSingle();

    const row = data as any;
    return { signerName: row?.signer_name || null, signerTitle: row?.signer_title || null };
}

/** Менеджер заказа фамилией — он вторым подписывает счёт. */
async function managerNameOf(managerId: unknown): Promise<string | null> {
    const id = Number(managerId);
    if (!Number.isFinite(id) || id <= 0) return null;

    const { data } = await supabase
        .from('managers')
        .select('first_name, last_name')
        .eq('id', id)
        .maybeSingle();

    const row = data as any;
    return [row?.first_name, row?.last_name].filter(Boolean).join(' ').trim() || null;
}

/**
 * Полное наименование юрлица — для оттиска печати: на печати стоит
 * «ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "…"», а не короткое имя.
 * Берём из нашего справочника юрлиц (RetailCRM отдаёт только короткое).
 */
async function sellerFullNameOf(seller: Seller | null): Promise<string | null> {
    const inn = seller?.inn?.trim();
    if (!inn) return null;

    const { data } = await supabase
        .from('legal_entities')
        .select('full_name, short_name')
        .eq('inn', inn)
        .maybeSingle();

    const row = data as any;
    return row?.full_name || row?.short_name || null;
}
