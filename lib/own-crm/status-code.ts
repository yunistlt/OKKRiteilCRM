/**
 * Код статуса заказа — один на весь проект.
 *
 * От RetailCRM отвязались (решение владельца 09.10.2026): статусы ведём у себя,
 * в `crm_statuses`, и основной код статуса — НАШ, из колонки `code`. Колонка
 * `external_code` осталась только как след старой связи: ею помечены статусы,
 * приехавшие когда-то из RetailCRM, и этим же кодом лежит статус в заказах,
 * созданных до отвязки.
 *
 * Раньше код статуса везде читался прямо из `external_code`, а статусы без него
 * молча выпадали: «Дубль заявки» был на доске «Статусы и переходы», но в карточке
 * заказа его не было — менеджеры не могли перевести заказ в дубль (поймано
 * 21.10.2026). Любой новый свой статус попадал бы в ту же яму.
 *
 * Поэтому: показываем и пишем свой `code`, а узнаём статус по ЛЮБОМУ из двух
 * кодов — чтобы старые заказы с кодом RetailCRM продолжали опознаваться.
 */
import { supabase } from '@/utils/supabase';

export type StatusCodeRow = {
    code?: string | null;
    external_code?: string | null;
};

/** Код, которым статус показываем и пишем в заказ. */
export function statusCodeOf(row: StatusCodeRow): string | null {
    const own = String(row.code ?? '').trim();
    if (own) return own;

    const external = String(row.external_code ?? '').trim();
    return external || null;
}

/** Все коды, под которыми статус может лежать в заказах: свой и старый из RetailCRM. */
export function statusKeysOf(row: StatusCodeRow): string[] {
    const keys = [row.code, row.external_code]
        .map((value) => String(value ?? '').trim())
        .filter(Boolean);

    return Array.from(new Set(keys));
}

/** Это тот самый статус? Сверяем по обоим кодам. */
export function statusMatches(row: StatusCodeRow, code: unknown): boolean {
    const value = String(code ?? '').trim();
    return Boolean(value) && statusKeysOf(row).includes(value);
}

/** Строка справочника по коду из заказа. */
export function findStatus<T extends StatusCodeRow>(rows: T[], code: unknown): T | undefined {
    return rows.find((row) => statusMatches(row, code));
}

/**
 * Карта «код из заказа → значение»: ключами идут оба кода статуса, поэтому
 * заказ опознаётся и со старым кодом RetailCRM, и с нашим.
 */
export function byStatusCode<T, R extends StatusCodeRow>(rows: R[], value: (row: R) => T): Map<string, T> {
    const map = new Map<string, T>();
    for (const row of rows) {
        const computed = value(row);
        for (const key of statusKeysOf(row)) map.set(key, computed);
    }
    return map;
}

/**
 * Названия статусов по кодам из заказов — один читатель на весь проект
 * (ЗАКОН «в интерфейсе только человеческий язык»).
 */
export async function statusNamesByCode(codes: string[]): Promise<Map<string, string>> {
    const wanted = Array.from(new Set(codes.map((c) => String(c ?? '').trim()).filter(Boolean)));
    if (!wanted.length) return new Map();

    const { data } = await supabase.from('crm_statuses').select('code, external_code, name');
    const all = byStatusCode((data ?? []) as any[], (row) => String(row.name ?? ''));

    const names = new Map<string, string>();
    for (const code of wanted) {
        const name = all.get(code);
        if (name) names.set(code, name);
    }
    return names;
}
