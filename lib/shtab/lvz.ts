import { createClient } from '@supabase/supabase-js';
import { decodeEntities } from '@/lib/sales-rop/letter-render';

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

/**
 * Название товара человеческим текстом.
 *
 * В каталоге сайта кавычки местами записаны кодом HTML («&quot;ШКОЛЬНИК&quot;»),
 * и в списке товаров он показывался буквами, как есть — так название уезжало
 * и в состав заказа, и в счёт. Раскодируем у себя; сайт не трогаем (решение
 * владельца 02.10.2026).
 */
function productName(value: unknown): string {
    return decodeEntities(String(value ?? '')).replace(/\s+/g, ' ').trim();
}

async function resolveCategories(rows: any[]): Promise<Record<string, string>> {
    const ids = Array.from(new Set(rows.map((r) => r.category_id).filter(Boolean)));
    if (ids.length === 0) return {};
    const { data } = await client().from('webasyst_categories').select('id, name').in('id', ids as any);
    return Object.fromEntries((data ?? []).map((c: any) => [String(c.id), productName(c.name)]));
}

/**
 * Разбор запроса на то, чем ищут.
 *
 * Модель («РШС-3-6», «ШСО-П-202») и габариты («1900x1400x620») — самое
 * различающее в названии, и именно они рубились старым разбором: дефис делил
 * «РШС-3-6» на «ршс», «3», «6», короткие куски отбрасывались, и от модели
 * оставалось «ршс» — общее для сотен товаров. Держим такие куски целыми.
 */
/**
 * Любое тире — к обычному дефису.
 *
 * В названиях каталога встречается длинное тире: «Шкаф сушильный для одежды
 * РШС–ВД» записан через «–» (U+2013), а менеджер набирает обычный «-». Поиск
 * сравнивал буквально и не находил ничего (жалоба Евгении Матвеевой
 * 06.10.2026 по заказу 52845: «на сайте есть, а в поиске нет»).
 */
export function normalizeDashes(text: string): string {
    return String(text ?? '').replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
}

export function catalogQueryParts(query: string): { models: string[]; words: string[] } {
    const text = normalizeDashes(String(query ?? '')).toLowerCase().replace(/\u00a0/g, ' ');

    /**
     * Кусок через дефис или точку — модель или габариты.
     *
     * Цифра в нём больше не обязательна: «РШС-ВД» — это тоже модель, а
     * прежнее правило выбрасывало её целиком. Дальше «ршс» уходило в слова,
     * «вд» терялось как слишком короткое, и поиск выдавал все РШС подряд,
     * кроме нужного.
     */
    const models = (text.match(/[a-zа-яё0-9]+(?:[-.x×][a-zа-яё0-9]+)+/gi) ?? [])
        .map((part) => part.replace(/[.,;]+$/, ''))
        .filter((part) => part.length >= 4);

    const words = text
        .split(/[^a-zа-яё0-9]+/i)
        .filter((word) => word.length >= 3 && !models.some((model) => model.includes(word)));

    return { models: Array.from(new Set(models)).slice(0, 4), words: Array.from(new Set(words)).slice(0, 6) };
}

export async function catalogSearch(query: string, limit = 15): Promise<Record<string, unknown>> {
    if (!marketingConfigured()) {
        return { available: false, reason: `Каталог не подключён: нет ${URL_KEY} / ${KEY_KEY}` };
    }

    const { models, words } = catalogQueryParts(query);
    if (!models.length && !words.length) return { available: false, reason: 'Слишком короткий запрос.' };

    const take = Math.min(50, Math.max(1, limit));

    try {
        /**
         * Ищем сужением, а не расширением.
         *
         * Старый поиск брал «ИЛИ» по словам, обрезал выдачу шестьюдесятью
         * строками и только потом ранжировал. На «Шкаф сушильный РШС-3-6 ЗМК
         * Комфорт (1900x1400x620 мм)» под «ИЛИ» подходило 1 573 товара, в
         * первые 60 (порядок базы, по id) нужный не попадал — менеджер вводил
         * точное название и не находил ничего (замечание Евгении 02.10.2026).
         *
         * Теперь: сначала все слова вместе («И»), потом только модель, потом
         * «И» с отбрасыванием слов с конца, и лишь в конце «ИЛИ» — но выдачу
         * ранжируем на большой выборке, а не на случайной горстке.
         */
        const search = async (parts: string[]) => {
            if (!parts.length) return [] as any[];
            let request = client()
                .from('marketing_products')
                .select('id, sku, name, price, full_url, category_id, meta, raw_data');
            // Дефис в образце — подстановочным знаком: в каталоге на его месте
            // бывает длинное тире, и точное сравнение не находило товар.
            for (const part of parts) request = request.ilike('name', `%${part.replace(/-/g, '_')}%`);
            const { data, error } = await request.limit(take);
            if (error) throw new Error(error.message);
            return (data ?? []) as any[];
        };

        const attempts: string[][] = [];
        if (models.length || words.length) attempts.push([...models, ...words]);
        if (models.length) attempts.push(models);
        // Отбрасываем слова с конца: лишнее слово в вводе не должно ронять поиск.
        for (let drop = 1; drop < words.length; drop++) {
            attempts.push([...models, ...words.slice(0, words.length - drop)]);
        }
        if (models.length) {
            // Модель по частям: «ршс-3-6» → «ршс-3» (в каталоге бывает другой разделитель).
            for (const model of models) {
                const head = model.split(/[-.x×]/).slice(0, 2).join('-');
                if (head.length >= 4) attempts.push([head, ...words.slice(0, 1)]);
            }
        }

        let rows: any[] = [];
        for (const parts of attempts) {
            rows = await search(parts);
            if (rows.length) break;
        }

        if (!rows.length) {
            // Последняя попытка — «ИЛИ», как раньше, но с большой выборкой и
            // ранжированием по числу совпавших слов.
            const all = [...models, ...words];
            const or = all.map((part) => `name.ilike.%${part.replace(/-/g, '_')}%`).join(',');
            const { data, error } = await client()
                .from('marketing_products')
                .select('id, sku, name, price, full_url, category_id, meta, raw_data')
                .or(or)
                .limit(500);
            if (error) throw new Error(error.message);

            rows = (data ?? [])
                .map((row: any) => ({
                    row,
                    score: all.reduce((sum, part) => sum + (String(row.name ?? '').toLowerCase().includes(part) ? 1 : 0), 0),
                }))
                .filter((hit) => hit.score > 0)
                .sort((left, right) => right.score - left.score)
                .slice(0, take)
                .map((hit) => hit.row);
        }

        const cats = await resolveCategories(rows);
        return {
            found: rows.length,
            note: 'Цена — снимок на момент импорта витрины, а не актуальный прайс.',
            items: rows.map((d: any) => ({
                id: String(d.id),
                // Артикул — ключ к карточке товара на сайте (по нему состав
                // заказа строит ссылку, см. lib/own-crm/catalog-links.ts).
                article: d.sku ? String(d.sku) : null,
                name: productName(d.name),
                price: Number(d.price) || 0,
                url: d.full_url || '',
                category: cats[String(d.category_id)] || '',
                active: String(d.meta?.status ?? '') === '1',
                /**
                 * Модификации товара: «на 24 пары», «на 30 пар» — у каждой своя
                 * цена и свой артикул. Без них менеджер добавлял в заказ
                 * родительскую карточку и не мог выбрать нужный размер
                 * (Лена Парфёнова 05.10.2026).
                 */
                variants: (Array.isArray(d.raw_data?.skus) ? d.raw_data.skus : [])
                    .filter((sku: any) => String(sku?.available ?? '1') !== '0')
                    .map((sku: any) => ({
                        id: String(sku.id),
                        name: String(sku.name ?? '').trim(),
                        article: sku.sku ? String(sku.sku) : null,
                        price: Number(sku.price) || 0,
                    }))
                    .filter((sku: any) => sku.name),
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
            categories: (cats.data ?? []).map((c: any) => productName(c.name)).slice(0, 60),
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
