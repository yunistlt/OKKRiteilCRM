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
import { catalogLinks } from './catalog-links';

export type DocumentItem = {
    name: string;
    quantity: number;
    price: number;
    /**
     * Цена до скидки и сумма скидки по строке. В КП от RetailCRM скидка
     * показана отдельной колонкой, и без неё клиент не видит, что ему уступили
     * (замечание Евгении 05.10.2026).
     */
    initialPrice: number;
    discount: number;
    /** Фото товара с его карточки на сайте, если товар там есть. */
    image: string | null;
    /**
     * Ссылка на карточку товара на сайте.
     *
     * Ирина Гордеева 05.10.2026: «ранее отправляли КП или счёт, там была ссылка
     * кликабельная (описание товара), можно было нажать и попадаешь на сайт на
     * страничку товара, сейчас просто описание». Ссылку мы уже знали — она
     * приходит из каталога вместе с фото, но до документа не доходила.
     */
    url: string | null;
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
    /** Полное наименование и подписант клиента — нужны договору. */
    payerFullName: string | null;
    payerSignerName: string | null;
    payerSignerTitle: string | null;
    payerSignerBasis: string | null;
    seller: Seller | null;
    /**
     * Срок изготовления в днях — «Срок изготовления в днях*» из заказа. Женя
     * 02.10.2026: «в счёте нет сроков производства».
     */
    productionDays: number | null;
    /**
     * Срок изготовления словами: «30 рабочих дней» или «30 календарных дней».
     * Одно «80» в документе читается двояко (замечание Евгении 05.10.2026).
     */
    productionTerm: string | null;
    /**
     * Как клиент получает: название способа доставки из справочника RetailCRM
     * плюс адрес. При самовывозе адрес — это откуда забирать, и менеджер
     * вписывает его руками в заказе (решение владельца 02.10.2026).
     */
    shippingTerms: string | null;
    /**
     * Сколько дней действительно предложение. Берём поле заказа «Счёт
     * действителен в течение (дней)*», которое менеджеры заполняют руками;
     * пусто — пять дней (решение владельца 05.10.2026).
     */
    validDays: number;
    /**
     * Разовая скидка на заказ — её ставит менеджер в карточке. В счёте её не
     * было вовсе: клиент видел полную сумму и не понимал, куда делась
     * договорённость (Лена Парфёнова 05.10.2026).
     */
    discountAmount: number;
    discountPercent: number;
    /** Что сказать про отгрузку: габариты, состав, особенности. */
    shippingNote: string | null;
    /** Кто подписывает счёт — из справочника наших юрлиц. */
    signerName: string | null;
    signerTitle: string | null;
    /** Контакты продавца для шапки документа. */
    sellerPhone: string | null;
    sellerEmail: string | null;
    sellerSite: string | null;
    /** Менеджер заказа: вторая подпись в счёте (решение владельца 02.10.2026). */
    managerName: string | null;
    /** Полное наименование продавца — по кольцу печати. */
    sellerFullName: string | null;
    /** Страна, регион и город — по нижней дуге печати. */
    sellerSealPlace: string | null;
    /**
     * Ставить ли печать. ИП работает без печати — только подпись
     * (указание владельца 02.10.2026).
     */
    sellerHasSeal: boolean;
    /** Настоящий оттиск печати картинкой, если загружен в настройках юрлица. */
    sealImage: string | null;
    /** Подпись руководителя картинкой. */
    signatureImage: string | null;
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
            .select('id, order_id, number, site, "contragent", "customer", "firstName", "lastName", "delivery", manager_id, srok_izgot_edinica, raw_payload')
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

    // Фото и ссылку берём из карточек товаров сайта: база товаров у нас — это
    // база сайта. Чего на сайте уже нет (архив), то останется строкой без
    // картинки и без ссылки — врать ссылкой в никуда нельзя.
    const catalog = await catalogByItem(rows);

    const items: DocumentItem[] = (rows || []).map((row: any) => ({
        name: row.offer?.displayName || row.offer?.name || row.productName || 'Позиция',
        quantity: Number(row.quantity || 0),
        // Цена за единицу с учётом скидки по позиции — то, что клиент увидит в счёте.
        price: Math.max(0, Number(row.initialPrice || 0) - (Number(row.quantity || 0) > 0
            ? Number(row.discountTotal || 0) / Number(row.quantity)
            : 0)),
        initialPrice: Number(row.initialPrice || 0),
        discount: Number(row.discountTotal || 0),
        image: catalogOf(catalog, row)?.image ?? null,
        url: catalogOf(catalog, row)?.url ?? null,
    }));

    const contragent = (order as any).contragent || (order as any).raw_payload?.contragent || {};
    /**
     * Клиента берём из `raw_payload`: колонка `orders.customer` мёртвая — синк
     * её не заполняет (закон проекта). Счёт без клиента не найдёт реквизиты
     * плательщика в его карточке, и плательщик в документе останется пустым.
     */
    const customer = (order as any).customer || (order as any).raw_payload?.customer || {};
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
    const payerFullName = clientRequisites?.fullName || null;
    const payerSignerName = clientRequisites?.signerName || null;
    const payerSignerTitle = clientRequisites?.signerTitle || null;
    const payerSignerBasis = clientRequisites?.signerBasis || null;

    const seller = await sellerFromSite(sellerCode || (order as any).site);

    return {
        orderNumber: String((order as any).number || crmOrderId),
        items,
        payerCompany,
        payerName: [(order as any).lastName, (order as any).firstName].filter(Boolean).join(' ') || null,
        payerInn,
        payerKpp,
        payerAddress,
        payerFullName,
        payerSignerName,
        payerSignerTitle,
        payerSignerBasis,
        // Юрлицо: по умолчанию то, чьему магазину принадлежит заказ, но счёт
        // можно выставить и от другого — юрлиц у компании несколько.
        seller,
        sellerOptions: await sellerOptions(),
        vatPercent: await vatPercentForSite(sellerCode || (order as any).site),
        productionDays: Number(customFields.srok_izgot) > 0 ? Number(customFields.srok_izgot) : null,
        productionTerm: productionTermText(
            Number(customFields.srok_izgot) > 0 ? Number(customFields.srok_izgot) : null,
            (order as any).srok_izgot_edinica,
        ),
        discountAmount: Number((order as any).raw_payload?.discountManualAmount ?? (order as any).discountManualAmount ?? 0) || 0,
        discountPercent: Number((order as any).raw_payload?.discountManualPercent ?? (order as any).discountManualPercent ?? 0) || 0,
        shippingNote: String(customFields.primecanie_po_otgruzke ?? '').trim() || null,
        validDays: Number(customFields.schiot_deistvitelen_v_techenie_dnei) > 0
            ? Number(customFields.schiot_deistvitelen_v_techenie_dnei)
            : 5,
        managerName: await managerNameOf((order as any).manager_id),
        ...(await sellerSealOf(seller)),
        shippingTerms: await shippingTermsText(delivery),
        ...(await signerOf(sellerCode || (order as any).site, seller)),
        total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    };
}

/**
 * Срок изготовления человеческим языком. Единица не указана — календарные:
 * так написано в прежних КП и договорах, и задним числом это менять нельзя.
 */
export function productionTermText(days: number | null, unit: unknown): string | null {
    if (!days || days <= 0) return null;

    const working = String(unit ?? '').trim() === 'rabochie';
    const last = days % 10;
    const teen = days % 100 >= 11 && days % 100 <= 14;
    const form = teen || last === 0 || last >= 5
        ? (working ? 'рабочих дней' : 'календарных дней')
        : last === 1
            ? (working ? 'рабочий день' : 'календарный день')
            : (working ? 'рабочих дня' : 'календарных дня');

    return `${days} ${form}`;
}

type CatalogEntry = { image: string | null; url: string | null };

/** Карточки товаров сайта по позициям заказа: ключ — id в 1С, id сайта, артикул. */
async function catalogByItem(rows: any[]): Promise<Map<string, CatalogEntry>> {
    const map = new Map<string, CatalogEntry>();
    try {
        const links = await catalogLinks({
            xmlIds: rows.map((row) => row?.offer?.xmlId),
            siteIds: rows.map((row) => row?.offer?.externalId),
            articles: rows.map((row) => row?.offer?.article),
        });
        for (const link of links) {
            const key = link.key.replace(/^(1c|id|art):/, '');
            const current = map.get(key);
            map.set(key, {
                image: current?.image ?? link.image ?? null,
                url: current?.url ?? link.url ?? null,
            });
        }
    } catch {
        // Каталог не ответил — документ соберётся без фото и ссылок, это не повод падать.
    }
    return map;
}

/** Карточка сайта для конкретной позиции заказа. */
function catalogOf(map: Map<string, CatalogEntry>, row: any): CatalogEntry | null {
    return map.get(String(row?.offer?.xmlId ?? '').split('#')[0])
        || map.get(String(row?.offer?.externalId ?? ''))
        || map.get(String(row?.offer?.article ?? ''))
        || null;
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
async function signerOf(siteCode: string | null | undefined, seller: Seller | null): Promise<{
    signerName: string | null;
    signerTitle: string | null;
    sellerPhone: string | null;
    sellerEmail: string | null;
    sellerSite: string | null;
}> {
    const empty = { signerName: null, signerTitle: null, sellerPhone: null, sellerEmail: null, sellerSite: null };
    const inn = seller?.inn?.trim();
    const code = String(siteCode ?? '').trim();
    if (!inn && !code) return empty;

    const { data } = await supabase
        .from('legal_entities')
        .select('inn, site_code, signer_name, signer_title, phone, email, site_url')
        .or([inn ? `inn.eq.${inn}` : null, code ? `site_code.eq.${code}` : null].filter(Boolean).join(','))
        .limit(1)
        .maybeSingle();

    const row = data as any;
    return {
        signerName: row?.signer_name || null,
        signerTitle: row?.signer_title || null,
        // Контакты в шапку документа: без них счёт выглядит запиской, а не
        // документом компании (Лена Парфёнова 05.10.2026).
        sellerPhone: row?.phone || null,
        sellerEmail: row?.email || null,
        sellerSite: row?.site_url || null,
    };
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
 * Что печатается на оттиске: полное наименование («ОБЩЕСТВО С ОГРАНИЧЕННОЙ
 * ОТВЕТСТВЕННОСТЬЮ "…"») и место («Россия, Республика Татарстан, город
 * Елабуга»). И то, и другое ведётся в нашем справочнике юрлиц и заполняется
 * из ЕГРЮЛ: RetailCRM отдаёт только короткое имя и банковский адрес.
 */
async function sellerSealOf(seller: Seller | null): Promise<{
    sellerFullName: string | null;
    sellerSealPlace: string | null;
    sellerHasSeal: boolean;
    sealImage: string | null;
    signatureImage: string | null;
}> {
    const inn = seller?.inn?.trim();
    const empty = { sellerFullName: null, sellerSealPlace: null, sellerHasSeal: false, sealImage: null, signatureImage: null };
    if (!inn) return empty;

    const { data } = await supabase
        .from('legal_entities')
        .select('full_name, short_name, seal_place, kind, seal_image_path, signature_image_path')
        .eq('inn', inn)
        .maybeSingle();

    const row = data as any;
    // ИП печати не имеет: подпись предпринимателя сама по себе достаточна.
    const soleTrader = String(row?.kind ?? '').toLowerCase() === 'ip' || inn.length === 12;

    return {
        sellerFullName: row?.full_name || row?.short_name || null,
        sellerSealPlace: row?.seal_place || null,
        sellerHasSeal: !soleTrader,
        sealImage: await imageDataUri(row?.seal_image_path),
        signatureImage: await imageDataUri(row?.signature_image_path),
    };
}

/**
 * Картинка из хранилища в виде data URI: генератор PDF работает с байтами, а
 * бакет приватный и ссылкой его не отдать.
 */
async function imageDataUri(path: unknown): Promise<string | null> {
    const key = String(path ?? '').trim();
    if (!key) return null;

    try {
        const file = await supabase.storage.from('okk-assets').download(key);
        if (!file.data) return null;

        const bytes = Buffer.from(await file.data.arrayBuffer());
        const type = file.data.type || (key.endsWith('.png') ? 'image/png' : 'image/jpeg');
        return `data:${type};base64,${bytes.toString('base64')}`;
    } catch (e: any) {
        console.warn('[documents] картинка не прочиталась:', key, e.message);
        return null;
    }
}
