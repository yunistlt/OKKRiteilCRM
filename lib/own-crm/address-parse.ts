/**
 * Разбор адреса доставки на части — как это было в RetailCRM.
 *
 * Лена Парфёнова 05.10.2026: «есть отдельное общее поле, мы туда писали
 * скопированный адрес, и была функция разбить по полям — адрес ставился
 * автоматом по колонкам (область, город, улицы…)».
 *
 * Берём подсказки Dadata: тот же бесплатный тариф, что и для поиска компании по
 * ИНН (10 000 запросов в день, секретный ключ не нужен). Без ключа и при любой
 * ошибке возвращаем пустой разбор — поле адреса остаётся как его написали, и
 * человек заполнит части руками.
 */
const ENDPOINT = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address';

export type AddressParts = {
    /** Исходная строка, приведённая к виду Dadata. */
    address: string | null;
    region: string | null;
    city: string | null;
    index: string | null;
    street: string | null;
    house: string | null;
};

const EMPTY: AddressParts = { address: null, region: null, city: null, index: null, street: null, house: null };

const text = (value: unknown): string | null => {
    const result = String(value ?? '').trim();
    return result || null;
};

export function addressParseConfigured(): boolean {
    return Boolean(process.env.DADATA_API_KEY?.trim());
}

export async function parseAddress(raw: string): Promise<AddressParts> {
    const query = String(raw ?? '').trim();
    if (!query || !addressParseConfigured()) return EMPTY;

    try {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Token ${process.env.DADATA_API_KEY}`,
            },
            body: JSON.stringify({ query, count: 1 }),
            signal: AbortSignal.timeout(8000),
        });

        if (!response.ok) return EMPTY;

        const payload: any = await response.json();
        const first = payload?.suggestions?.[0];
        if (!first) return EMPTY;

        const data = first.data ?? {};
        return {
            address: text(first.value),
            // Город федерального значения приезжает регионом, а города нет —
            // тогда город берём из региона, иначе поле останется пустым.
            region: text(data.region_with_type),
            city: text(data.city_with_type) || text(data.settlement_with_type) || text(data.region_with_type),
            index: text(data.postal_code),
            street: text(data.street_with_type),
            house: [text(data.house_type), text(data.house)].filter(Boolean).join(' ') || null,
        };
    } catch {
        return EMPTY;
    }
}
