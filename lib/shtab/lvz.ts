import { createClient } from '@supabase/supabase-js';

// Соседний проект LVZCalc_bot: витрина zmktlt.ru, расчёты стоимости, маркетинг
// и продажи. Всё это живёт в его Supabase, и туда же смотрит сервис расчётов
// (yunistlt-lvzcalc-bot-07ea.twc1.net).
//
// Ходим туда тем же REST-доступом, каким уже ходит виджет Елены
// (app/api/widget/chat/route.ts), а не строкой подключения к Postgres. Причина
// простая: доступ уже заведён и ограничен ключом на чтение, а заводить вторую
// дорогу к чужой базе — это второй набор прав, который однажды разойдётся с
// первым.
//
// Цена здесь видна: это инструмент владельца, а не виджета. Клиенту цену
// по-прежнему не называют — это делает менеджер.

const URL_KEY = 'LVZ_SUPABASE_URL';
const KEY_KEY = 'LVZ_SUPABASE_ANON_KEY';

export function marketingConfigured(): boolean {
    return Boolean(process.env[URL_KEY]?.trim() && process.env[KEY_KEY]?.trim());
}

function client() {
    return createClient(process.env[URL_KEY]!, process.env[KEY_KEY]!);
}

/** Активная позиция витрины. Статус лежит строкой в meta — так его пишет Webasyst. */
const ACTIVE = { column: 'meta->>status', value: '1' };

export type CatalogItem = {
    id: string;
    name: string;
    price: number;
    url: string;
    category: string;
    active: boolean;
};

async function resolveCategories(rows: any[]): Promise<Record<string, string>> {
    const ids = Array.from(new Set(rows.map((r) => r.category_id).filter(Boolean)));
    if (ids.length === 0) return {};
    const { data } = await client().from('webasyst_categories').select('id, name').in('id', ids as any);
    return Object.fromEntries((data ?? []).map((c: any) => [String(c.id), c.name]));
}

export async function catalogSearch(query: string, limit = 15): Promise<Record<string, unknown>> {
    if (!marketingConfigured()) {
        return { available: false, reason: `Каталог не подключён: нет ${URL_KEY} / ${KEY_KEY}` };
    }
    const words = query
        .toLowerCase()
        .split(/[^a-zа-яё0-9]+/i)
        .filter((w) => w.length >= 3)
        .slice(0, 6);
    if (words.length === 0) return { available: false, reason: 'Слишком короткий запрос.' };

    try {
        // Поиск широкий, через ИЛИ по словам, а потом ранжирование по числу
        // совпавших: строгое И ломается о лишнее слово в вопросе.
        const or = words.map((w) => `name.ilike.%${w}%`).join(',');
        const { data, error } = await client()
            .from('marketing_products')
            .select('id, name, price, full_url, category_id, meta')
            .or(or)
            .limit(60);
        if (error) throw new Error(error.message);

        const rows = (data ?? [])
            .map((d: any) => ({ d, score: words.reduce((a, w) => a + (String(d.name ?? '').toLowerCase().includes(w) ? 1 : 0), 0) }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, Math.min(50, Math.max(1, limit)))
            .map((x) => x.d);

        const cats = await resolveCategories(rows);
        return {
            found: rows.length,
            note: 'Цена — снимок на момент импорта витрины, а не актуальный прайс.',
            items: rows.map((d: any) => ({
                id: String(d.id),
                name: d.name,
                price: Number(d.price) || 0,
                url: d.full_url || '',
                category: cats[String(d.category_id)] || '',
                active: String(d.meta?.status ?? '') === '1',
            })),
        };
    } catch (e: any) {
        return { available: false, reason: `Каталог не ответил: ${e.message}` };
    }
}

export async function catalogOverview(): Promise<Record<string, unknown>> {
    if (!marketingConfigured()) {
        return { available: false, reason: `Каталог не подключён: нет ${URL_KEY} / ${KEY_KEY}` };
    }
    try {
        const db = client();
        const [total, active, withPrice, cats] = await Promise.all([
            db.from('marketing_products').select('id', { count: 'exact', head: true }),
            db.from('marketing_products').select('id', { count: 'exact', head: true }).eq(ACTIVE.column, ACTIVE.value),
            db.from('marketing_products').select('id', { count: 'exact', head: true }).gt('price', 0),
            db.from('webasyst_categories').select('id, name').limit(200),
        ]);
        if (total.error) throw new Error(total.error.message);

        return {
            products_total: total.count ?? 0,
            products_active: active.count ?? 0,
            // Позиция без цены на витрине не продаётся — это отдельная строка,
            // а не мелочь: по ней видно, сколько каталога стоит мёртвым грузом.
            products_with_price: withPrice.count ?? 0,
            categories_total: (cats.data ?? []).length,
            categories: (cats.data ?? []).map((c: any) => c.name).slice(0, 60),
            note: 'Витрина zmktlt.ru: данные из соседнего проекта, цена — снимок на момент импорта.',
        };
    } catch (e: any) {
        return { available: false, reason: `Каталог не ответил: ${e.message}` };
    }
}


// ── база соседнего проекта целиком ─────────────────────────────────────────────
// Белый список, а не «любая таблица»: у проекта есть служебные таблицы (логи,
// админы, ключи API), и Тамаре там делать нечего. Список пополняется руками —
// это и есть решение о том, что ей показывать.
//
// Назначение каждой таблицы написано здесь же: без него модель угадывает по
// названию и путает расчёты верстака с расчётами муфельной печи.
export const LVZ_TABLES: Record<string, string> = {
    calculations: 'Расчёты стоимости, общая таблица: кто считал, что ввёл, что получилось.',
    calculations_workbench: 'Расчёты верстаков.',
    calculations_lvz: 'Расчёты линий верхнего завеса (ЛВЗ).',
    calculations_crane: 'Расчёты кранового оборудования.',
    calculations_muffle: 'Расчёты муфельных печей.',
    calculations_battery: 'Расчёты аккумуляторных решений.',
    projects: 'Проекты продаж: клиент, номер заказа, статус.',
    project_items: 'Позиции проектов: что именно в проекте.',
    marketing_products: 'Витрина zmktlt.ru: позиции с ценой, категорией и ссылкой.',
    marketing_audits: 'Проверки карточек товара маркетинговыми агентами: что предложено и принято ли.',
    marketing_ads_metrics: 'Показатели рекламы.',
    webasyst_categories: 'Разделы витрины.',
    prices: 'Справочник цен и коэффициентов расчётчика.',
    web_chat_history: 'Переписка в веб-чате сервиса расчётов.',
};

export function lvzTables(): Record<string, unknown> {
    if (!marketingConfigured()) {
        return { available: false, reason: `База соседнего проекта не подключена: нет ${URL_KEY} / ${KEY_KEY}` };
    }
    return {
        note: 'Читается только это. Столбцы посмотри через lvz_read с limit 1.',
        tables: Object.entries(LVZ_TABLES).map(([table, purpose]) => ({ table, purpose })),
    };
}

type Filter = { column: string; op: string; value: string };

const OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike']);

/**
 * Чтение таблицы соседнего проекта.
 *
 * Произвольного SQL тут нет и не будет: ходим REST-доступом, тем же, что и
 * виджет Елены. Поэтому считать итоги нечем — Тамара берёт строки и считает
 * сама, а чтобы она не тянула тысячи строк ради одного числа, есть count.
 */
export async function lvzRead(opts: {
    table: string;
    columns?: string;
    filters?: Filter[];
    order?: string;
    descending?: boolean;
    limit?: number;
    count_only?: boolean;
}): Promise<Record<string, unknown>> {
    // Белый список проверяется раньше подключения: запрещённая таблица
    // запрещена независимо от того, настроен доступ или нет, и ответ об этом
    // должен быть один и тот же в любой среде.
    if (!LVZ_TABLES[opts.table]) {
        return { available: false, reason: `Таблица «${opts.table}» не из списка разрешённых. Посмотри lvz_tables.` };
    }
    if (!marketingConfigured()) {
        return { available: false, reason: `База соседнего проекта не подключена: нет ${URL_KEY} / ${KEY_KEY}` };
    }
    try {
        const db = client();
        let q = db
            .from(opts.table)
            .select(opts.columns?.trim() || '*', opts.count_only ? { count: 'exact', head: true } : { count: 'exact' });

        for (const f of opts.filters ?? []) {
            if (!OPS.has(f.op)) return { available: false, reason: `Условие «${f.op}» не поддерживается.` };
            q = (q as any)[f.op](f.column, f.value);
        }
        if (opts.order) q = q.order(opts.order, { ascending: !opts.descending });
        if (!opts.count_only) q = q.limit(Math.min(200, Math.max(1, opts.limit ?? 50)));

        const { data, count, error } = await q;
        if (error) throw new Error(error.message);

        return {
            table: opts.table,
            purpose: LVZ_TABLES[opts.table],
            total_matching: count ?? null,
            returned: opts.count_only ? 0 : (data ?? []).length,
            rows: opts.count_only ? undefined : data ?? [],
        };
    } catch (e: any) {
        return { available: false, reason: `База соседнего проекта не ответила: ${e.message}` };
    }
}

/** Сводка расчётов по типам за период: сколько считали и когда последний раз. */
export async function lvzCalcSummary(days = 90): Promise<Record<string, unknown>> {
    if (!marketingConfigured()) {
        return { available: false, reason: `База соседнего проекта не подключена: нет ${URL_KEY} / ${KEY_KEY}` };
    }
    const since = new Date(Date.now() - Math.min(730, Math.max(1, days)) * 86_400_000).toISOString();
    const tables = Object.keys(LVZ_TABLES).filter((t) => t.startsWith('calculations'));
    try {
        const db = client();
        const rows = await Promise.all(
            tables.map(async (t) => {
                const [period, all, last] = await Promise.all([
                    db.from(t).select('id', { count: 'exact', head: true }).gte('created_at', since),
                    db.from(t).select('id', { count: 'exact', head: true }),
                    db.from(t).select('created_at, username').order('created_at', { ascending: false }).limit(1),
                ]);
                return {
                    table: t,
                    purpose: LVZ_TABLES[t],
                    за_период: period.count ?? 0,
                    всего: all.count ?? 0,
                    последний: last.data?.[0]?.created_at ?? null,
                    последний_считал: last.data?.[0]?.username ?? null,
                };
            }),
        );
        return { since: since.slice(0, 10), calculations: rows };
    } catch (e: any) {
        return { available: false, reason: `База соседнего проекта не ответила: ${e.message}` };
    }
}
