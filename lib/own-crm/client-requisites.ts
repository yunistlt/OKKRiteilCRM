/**
 * Реквизиты заказчика: принадлежат КЛИЕНТУ, в заказ подтягиваются.
 *
 * Решение владельца 02.10.2026: «реквизиты заказчика не могут быть атрибутом
 * заказа, это атрибуты заказчика; в заказ они подтягиваются из карточки
 * клиента». RetailCRM держит их на заказе — поэтому старые реквизиты мы оттуда
 * и забираем (`fromOrderNumber`), но дальше живут они у клиента.
 *
 * Живут в таблице клиентов (`clients`): она у нас уже есть и синкается с
 * RetailCRM. Часть колонок оттуда и приехала (`company_name`, `inn`, `kpp`,
 * `contragent_type`), остальные добавлены именами RetailCRM
 * (`legalName`, `bank`, `bankAccount`, `BIK`, `corrAccount`, `legalAddress`,
 * `OGRN`, `OGRNIP`, `bankAddress`). Отдельной таблицы нет намеренно: одна
 * сущность — одна таблица. Синхронизация реквизиты больше не стирает —
 * `upsert_clients` дополняет их через COALESCE (миграция
 * `20261002_client_requisites_in_clients.sql`).
 */
import { supabase } from '@/utils/supabase';

export type Requisites = {
    contragentType: string | null;
    /** Сокращённое название: ООО «БРМЗ». */
    legalName: string | null;
    /**
     * Полное наименование: «Общество с ограниченной ответственностью
     * „Благовещенский Ремонтно-Механический Завод"». Нужно в договорах и
     * счетах, где сокращённого мало (просьба Лены Парфёновой 05.10.2026).
     */
    fullName: string | null;
    /**
     * Кто подписывает договор со стороны клиента и на каком основании.
     * «в лице генерального директора Иванова И. И., действующего на основании
     * Устава» — без этих трёх полей договор не составить (просьба Лены
     * Парфёновой 05.10.2026).
     */
    signerName: string | null;
    signerTitle: string | null;
    signerBasis: string | null;
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
    contragentType: null, legalName: null, fullName: null,
    signerName: null, signerTitle: null, signerBasis: null, inn: null, kpp: null, ogrn: null, ogrnip: null,
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
        // В заказе RetailCRM полного наименования и подписанта нет — они
        // только в карточке клиента.
        fullName: null,
        signerName: null,
        signerTitle: null,
        signerBasis: null,
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
        legalName: text(row.legalName) || text(row.company_name),
        fullName: text(row.full_name),
        signerName: text(row.signer_name),
        signerTitle: text(row.signer_title),
        signerBasis: text(row.signer_basis),
        inn: text(row.inn),
        kpp: text(row.kpp),
        ogrn: text(row.OGRN),
        ogrnip: text(row.OGRNIP),
        legalAddress: text(row.legalAddress),
        bank: text(row.bank),
        bankAccount: text(row.bankAccount),
        bik: text(row.BIK),
        corrAccount: text(row.corrAccount),
        bankAddress: text(row.bankAddress),
    };
}

const CLIENT_COLUMNS =
    'contragent_type, company_name, full_name, signer_name, signer_title, signer_basis, inn, kpp, "legalName", "legalAddress", "bank", "bankAccount", "BIK", "corrAccount", "bankAddress", "OGRN", "OGRNIP", requisites_updated_at, requisites_updated_by';

/** Есть ли в карточке хоть что-то, кроме пустоты. */
function filled(requisites: Requisites): boolean {
    return Object.values(requisites).some((value) => Boolean(value));
}

/**
 * Реквизиты клиента из его карточки. Пока их там нет — показываем те, что
 * лежат в последнем заказе, и честно говорим, откуда они (закон «цифры
 * раскладываются»).
 */
export async function loadClientRequisites(clientId: number | string): Promise<ClientRequisitesCard> {
    const id = String(clientId ?? '').trim();
    if (!id) return { ...EMPTY, source: 'none', fromOrderNumber: null, updatedAt: null, updatedBy: null };

    const { data: card } = await supabase
        .from('clients')
        .select(CLIENT_COLUMNS)
        .eq('id', id)
        .maybeSingle();

    const fromCard = card ? rowToRequisites(card) : { ...EMPTY };

    // Банковские реквизиты в карточке — признак того, что их вносил человек:
    // из RetailCRM приезжают только название, ИНН, КПП и тип.
    const ownEntry = Boolean((card as any)?.requisites_updated_at) || Boolean(fromCard.bankAccount || fromCard.bank);

    if (ownEntry && filled(fromCard)) {
        return {
            ...fromCard,
            source: 'client',
            fromOrderNumber: null,
            updatedAt: (card as any)?.requisites_updated_at ?? null,
            updatedBy: (card as any)?.requisites_updated_by ?? null,
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
        const fromOrder = fromOrderContragent(last.contragent);
        // Карточка главнее в том, что в ней есть: заказ только дополняет.
        return {
            contragentType: fromCard.contragentType || fromOrder.contragentType,
            legalName: fromCard.legalName || fromOrder.legalName,
            fullName: fromCard.fullName,
            signerName: fromCard.signerName,
            signerTitle: fromCard.signerTitle,
            signerBasis: fromCard.signerBasis,
            inn: fromCard.inn || fromOrder.inn,
            kpp: fromCard.kpp || fromOrder.kpp,
            ogrn: fromCard.ogrn || fromOrder.ogrn,
            ogrnip: fromCard.ogrnip || fromOrder.ogrnip,
            legalAddress: fromCard.legalAddress || fromOrder.legalAddress,
            bank: fromCard.bank || fromOrder.bank,
            bankAccount: fromCard.bankAccount || fromOrder.bankAccount,
            bik: fromCard.bik || fromOrder.bik,
            corrAccount: fromCard.corrAccount || fromOrder.corrAccount,
            bankAddress: fromCard.bankAddress || fromOrder.bankAddress,
            source: 'order',
            fromOrderNumber: text(last.number),
            updatedAt: null,
            updatedBy: null,
        };
    }

    return {
        ...fromCard,
        source: filled(fromCard) ? 'client' : 'none',
        fromOrderNumber: null,
        updatedAt: (card as any)?.requisites_updated_at ?? null,
        updatedBy: (card as any)?.requisites_updated_by ?? null,
    };
}

/** Сохранить реквизиты в карточке клиента. */
export async function saveClientRequisites(
    clientId: number | string,
    requisites: Partial<Requisites>,
    actor?: string | null,
): Promise<void> {
    const id = Number(clientId);
    if (!Number.isFinite(id)) throw new Error('Не понял, какому клиенту сохранять реквизиты');

    /**
     * Пишем ТОЛЬКО то, что прислали.
     *
     * Раньше сохранялись все поля разом — тем снимком, которым форма
     * открылась. Если за время правки данные менялись (второй человек, перенос
     * из заказа, слияние карточек), сохранение затирало их пустотой: у ООО
     * «УАС» так пропал ОГРН, а до того — банковские реквизиты (жалобы Евгении
     * Матвеевой 09.10.2026). Теперь поле, которого в запросе нет, остаётся в
     * базе нетронутым.
     *
     * Пустая строка — это осознанная очистка поля человеком, она проходит.
     */
    const columns: Array<[keyof Requisites, string]> = [
        ['contragentType', 'contragent_type'],
        ['legalName', 'legalName'],
        ['fullName', 'full_name'],
        ['signerName', 'signer_name'],
        ['signerTitle', 'signer_title'],
        ['signerBasis', 'signer_basis'],
        ['inn', 'inn'],
        ['kpp', 'kpp'],
        ['ogrn', 'OGRN'],
        ['ogrnip', 'OGRNIP'],
        ['legalAddress', 'legalAddress'],
        ['bank', 'bank'],
        ['bankAccount', 'bankAccount'],
        ['bik', 'BIK'],
        ['corrAccount', 'corrAccount'],
        ['bankAddress', 'bankAddress'],
    ];

    const row: Record<string, unknown> = {
        requisites_updated_by: text(actor),
        requisites_updated_at: new Date().toISOString(),
    };

    for (const [field, column] of columns) {
        if (requisites[field] === undefined) continue;
        row[column] = text(requisites[field]);
    }

    // `company_name` приезжает из RetailCRM и показывается в списке клиентов:
    // держим его в согласии с юридическим названием, если его внесли.
    if (text(requisites.legalName)) row.company_name = text(requisites.legalName);

    // Кроме служебных отметок ничего не прислали — сохранять нечего.
    if (Object.keys(row).length <= 2) return;

    const { error } = await supabase.from('clients').update(row).eq('id', id);
    if (error) throw new Error(`Не удалось сохранить реквизиты: ${error.message}`);
}
