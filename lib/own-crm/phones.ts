/**
 * Телефоны заказа: один номер приходит из нескольких мест и записан по-разному.
 *
 * В заказе 49583 рабочий номер лежал сразу в поле заказа («+7 (812) 670-23-03»),
 * в колонке («+78126702303») и в контакте RetailCRM — и карточка показывала его
 * во всех трёх полях, а мобильный клиента не показывала вовсе (поймано
 * 02.10.2026). Поэтому список телефонов склеиваем по цифрам.
 */

/** Последние 10 цифр — по ним номер и узнаётся, как бы его ни записали. */
export function phoneKey(value: unknown): string {
    return String(value ?? '').replace(/\D/g, '').slice(-10);
}

/**
 * Уникальные телефоны в порядке важности источников.
 * Слишком короткие обрывки (меньше 6 цифр) не считаем номерами.
 */
export function uniquePhones(list: Array<unknown>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const value of list) {
        const phone = String(value ?? '').trim();
        const key = phoneKey(phone);
        if (!phone || key.length < 6 || seen.has(key)) continue;
        seen.add(key);
        out.push(phone);
    }

    return out;
}
