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

/**
 * Все названия статусов разом — для экранов, где заказов много и коды заранее
 * неизвестны. Ключи — оба кода статуса (свой и старый), так что подпишется и
 * старый заказ.
 *
 * Имя статуса живёт в одном месте — на доске «Статусы и переходы»
 * (`crm_statuses`). Раньше его читали ещё из двух таблиц, оставшихся от
 * импорта, и статус, заведённый на доске, показывался кодом: «dubl-zayavki»
 * вместо «Дубль заявки» (25.10.2026). Сторож — `tests/status-names-single-source.test.ts`.
 */
export async function loadStatusNames(): Promise<Map<string, string>> {
    const { data } = await supabase.from('crm_statuses').select('code, external_code, name');
    return byStatusCode((data ?? []) as any[], (row) => String(row.name ?? ''));
}

export type StatusDirectoryRow = {
    code: string;
    name: string;
    active: boolean;
    isWorking: boolean;
    color: string | null;
    groupId: string | null;
    /** Название этапа: им статусы сгруппированы. */
    groupName: string | null;
    /** Порядок этапа: вместе с `ordering` даёт место статуса в потоке работы. */
    groupOrdering: number;
    /** Сколько дней заказу позволено стоять в этом статусе (null — не судим). */
    normDays: number | null;
    ordering: number;
    /** Старый код: по нему лежат статусы заказов, созданных до отвязки. */
    externalCode: string | null;
};

/**
 * Справочник статусов для выпадающих списков и настроек: состав и порядок —
 * с доски (ЗАКОН «порядок статусов — с доски»).
 *
 * По умолчанию отдаёт только действующие статусы (ЗАКОН «только активные
 * сущности»); историю просят явно, когда надо подписать старый заказ.
 */
export async function loadStatusDirectory(opts: { withInactive?: boolean } = {}): Promise<StatusDirectoryRow[]> {
    const [{ data }, { data: groups }] = await Promise.all([
        supabase
            .from('crm_statuses')
            .select('code, external_code, name, active, is_working, color, group_id, ordering')
            .order('ordering', { ascending: true }),
        supabase.from('crm_status_groups').select('id, name, color, ordering'),
    ]);

    // ЗАКОН: цвет у этапа, а не у статуса. У самих статусов колонка цвета
    // пустая — красит группа, как на доске.
    const groupById = new Map<string, { name: string; color: string | null; ordering: number }>(
        ((groups ?? []) as any[]).map((g) => [String(g.id), {
            name: String(g.name ?? ''),
            color: g.color ?? null,
            ordering: Number(g.ordering ?? 999),
        }]),
    );

    return ((data ?? []) as any[])
        .filter((row) => (opts.withInactive ? true : row.active === true))
        .map((row) => ({
            code: String(statusCodeOf(row) ?? ''),
            name: String(row.name ?? ''),
            active: row.active === true,
            isWorking: row.is_working === true,
            color: row.color ?? (row.group_id ? groupById.get(String(row.group_id))?.color ?? null : null),
            groupId: row.group_id ? String(row.group_id) : null,
            groupName: row.group_id ? groupById.get(String(row.group_id))?.name ?? null : null,
            groupOrdering: row.group_id ? groupById.get(String(row.group_id))?.ordering ?? 999 : 999,
            normDays: typeof row.norm_days === 'number' ? row.norm_days : null,
            ordering: Number(row.ordering ?? 999),
            externalCode: row.external_code ? String(row.external_code) : null,
        }))
        .filter((row) => row.code && row.name);
}

/** Как показать статус человеку: название, цвет этапа и сам этап. */
export type StatusLook = { name: string; color: string | null; groupName: string | null };

/**
 * Как показать любой статус — одна функция на весь проект.
 *
 * Ключи — оба кода статуса, поэтому подписывается и старый заказ, лежащий под
 * кодом времён RetailCRM. Цвет берётся у этапа: у самих статусов колонка цвета
 * пустая, красит доска (ЗАКОН «порядок и цвет статусов — с доски»).
 */
export async function loadStatusPalette(): Promise<Map<string, StatusLook>> {
    const rows = await loadStatusDirectory({ withInactive: true });
    const palette = new Map<string, StatusLook>();
    for (const row of rows) {
        const look: StatusLook = { name: row.name, color: row.color, groupName: row.groupName };
        for (const code of [row.code, row.externalCode].filter(Boolean) as string[]) {
            palette.set(code, look);
        }
    }
    return palette;
}

/**
 * Место статуса в потоке работы: сначала этап, потом порядок внутри этапа.
 *
 * Сравнивать статусы по одному `ordering` нельзя — он считается внутри этапа,
 * и «Новый» (1) сравнялся бы с «Отменён» (1).
 */
export function statusRank(row: { groupOrdering: number; ordering: number }): number {
    return row.groupOrdering * 1000 + row.ordering;
}
