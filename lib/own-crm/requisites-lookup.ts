/**
 * Заполнение реквизитов клиента: по ИНН и по файлу карточки предприятия.
 *
 * Ирина Гордеева и владелец 05.10.2026: «сделай, чтобы по карточке клиента
 * заполнялись реквизиты — можно было подгрузить файл, а он его распознал, и по
 * ИНН тоже мог распознать». Менеджер переписывает полтора десятка полей руками
 * с присланной карточки предприятия, и ошибается в счёте.
 *
 * По ИНН берём Dadata: там государственные данные — название, адрес, ОГРН,
 * КПП и руководитель. Банковских реквизитов в ЕГРЮЛ нет и быть не может,
 * поэтому счёт и банк остаются за файлом или руками.
 */
import type { Requisites } from './client-requisites';

const PARTY = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party';

const text = (value: unknown): string | null => {
    const result = String(value ?? '').trim();
    return result || null;
};

export function lookupConfigured(): boolean {
    return Boolean(process.env.DADATA_API_KEY?.trim());
}

export type LookupResult = {
    requisites: Partial<Requisites>;
    /** Что стоит знать до разговора: ликвидируется ли компания. */
    status: string | null;
};

/** Реквизиты по ИНН из государственного реестра. */
export async function lookupByInn(inn: string): Promise<LookupResult | null> {
    const query = String(inn ?? '').replace(/\D+/g, '');
    if (!/^(\d{10}|\d{12})$/.test(query) || !lookupConfigured()) return null;

    try {
        const response = await fetch(PARTY, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Token ${process.env.DADATA_API_KEY}`,
            },
            body: JSON.stringify({ query }),
            signal: AbortSignal.timeout(8000),
        });

        if (!response.ok) return null;

        const payload: any = await response.json();
        const data = payload?.suggestions?.[0]?.data;
        if (!data) return null;

        return {
            requisites: {
                legalName: text(data.name?.short_with_opf),
                fullName: text(data.name?.full_with_opf),
                inn: text(data.inn),
                kpp: text(data.kpp),
                ogrn: text(data.ogrn),
                legalAddress: text(data.address?.unrestricted_value),
                // Руководитель из реестра — он же подписывает договор.
                signerName: text(data.management?.name),
                signerTitle: text(data.management?.post),
                signerBasis: data.management?.name ? 'Устава' : null,
            },
            status: text(data.state?.status),
        };
    } catch {
        return null;
    }
}


/**
 * Реквизиты из текста карточки предприятия.
 *
 * Карточку присылают по-разному — PDF, скан, вордовский файл, — но набор строк
 * в ней один и тот же: ИНН, КПП, ОГРН, банк, счёт, БИК, корсчёт, директор.
 * Ищем их по образцу, а не моделью: образцы предсказуемы, бесплатны и не
 * выдумывают цифры, а ошибка в расчётном счёте стоит дороже удобства.
 */
export function parseRequisitesFromText(raw: string): Partial<Requisites> {
    const source = String(raw ?? '').replace(/\u00a0/g, ' ');
    const digits = (value: string | null) => (value ? value.replace(/\D+/g, '') : null);

    const find = (pattern: RegExp): string | null => {
        const match = pattern.exec(source);
        return match ? (match[1] ?? '').trim() || null : null;
    };

    const inn = digits(find(/ИНН[^0-9]{0,15}(\d[\d\s]{8,13})/i));
    const kpp = digits(find(/КПП[^0-9]{0,15}(\d[\d\s]{7,11})/i));
    const ogrn = digits(find(/ОГРН(?:ИП)?[^0-9]{0,15}(\d[\d\s]{11,16})/i));
    const account = digits(find(/(?:р\/?\s*с|расч[её]тный счет|расч[её]тный счёт)[^0-9]{0,20}(\d[\d\s]{18,25})/i));
    const corr = digits(find(/(?:к\/?\s*с|корр[^\n]{0,15}сч[её]т)[^0-9]{0,20}(\d[\d\s]{18,25})/i));
    const bik = digits(find(/БИК[^0-9]{0,15}(\d[\d\s]{8,12})/i));

    return {
        inn: inn && (inn.length === 10 || inn.length === 12) ? inn : null,
        kpp: kpp && kpp.length === 9 ? kpp : null,
        ogrn: ogrn && (ogrn.length === 13 || ogrn.length === 15) ? ogrn : null,
        bankAccount: account && account.length === 20 ? account : null,
        corrAccount: corr && corr.length === 20 ? corr : null,
        bik: bik && bik.length === 9 ? bik : null,
        bank: find(/(?:Банк|Наименование банка)[^A-Za-zА-Яа-я0-9]{0,5}([^\n]{3,120})/i),
        legalName: find(/(?:Полное наименование|Наименование организации|Организация)[^A-Za-zА-Яа-я0-9]{0,5}([^\n]{3,200})/i),
        legalAddress: find(/(?:Юридический адрес|Адрес регистрации|Юр\.?\s*адрес)[^A-Za-zА-Яа-я0-9]{0,5}([^\n]{5,200})/i),
        signerName: find(/(?:Генеральный директор|Директор|Руководитель)[^A-Za-zА-Яа-я]{0,5}([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/),
        signerTitle: find(/(Генеральный директор|Директор|Руководитель|Индивидуальный предприниматель)/i),
    };
}
