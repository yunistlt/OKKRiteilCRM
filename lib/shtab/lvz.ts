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

/**
 * \u041B\u0430\u0442\u0438\u043D\u0441\u043A\u0438\u0435 \u0431\u0443\u043A\u0432\u044B, \u043D\u0435\u043E\u0442\u043B\u0438\u0447\u0438\u043C\u044B\u0435 \u043D\u0430 \u0432\u0438\u0434 \u043E\u0442 \u0440\u0443\u0441\u0441\u043A\u0438\u0445, \u2014 \u043A \u0440\u0443\u0441\u0441\u043A\u0438\u043C.
 *
 * \u0412 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F\u0445 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0430 \u043E\u043D\u0438 \u043F\u0435\u0440\u0435\u043C\u0435\u0448\u0430\u043D\u044B: \u00AB\u0428\u043A\u0430\u0444 \u0441\u0443\u0448\u0438\u043B\u044C\u043D\u044B\u0439 \u0428\u0421**O** 02\u00BB \u043D\u0430\u043F\u0438\u0441\u0430\u043D \u0441
 * \u043B\u0430\u0442\u0438\u043D\u0441\u043A\u043E\u0439 \u00ABO\u00BB, \u00AB**C**\u0443\u0448\u0438\u043B\u044C\u043D\u044B\u0439 \u0448\u043A\u0430\u0444 \u2026 \u0417\u0432\u0435\u0437\u0434\u0430\u00BB \u2014 \u0441 \u043B\u0430\u0442\u0438\u043D\u0441\u043A\u043E\u0439 \u00ABC\u00BB, \u00AB**\u0415**RGO\u00BB \u2014
 * \u043D\u0430\u043E\u0431\u043E\u0440\u043E\u0442, \u0441 \u0440\u0443\u0441\u0441\u043A\u043E\u0439 \u00AB\u0415\u00BB. \u0422\u0430\u043A\u0438\u0445 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0439 \u043D\u0430 \u0432\u0438\u0442\u0440\u0438\u043D\u0435 67 \u0438\u0437 8 291, \u0438 \u0433\u043B\u0430\u0437\u043E\u043C \u0438\u0445
 * \u043D\u0435 \u043E\u0442\u043B\u0438\u0447\u0438\u0442\u044C: \u043C\u0435\u043D\u0435\u0434\u0436\u0435\u0440 \u043D\u0430\u0431\u0438\u0440\u0430\u0435\u0442 \u00AB\u0428\u0421\u041E-02\u00BB \u0440\u0443\u0441\u0441\u043A\u0438\u043C\u0438 \u0431\u0443\u043A\u0432\u0430\u043C\u0438, \u043F\u043E\u0438\u0441\u043A \u0441\u0440\u0430\u0432\u043D\u0438\u0432\u0430\u0435\u0442
 * \u043F\u043E\u0431\u0443\u043A\u0432\u0435\u043D\u043D\u043E \u0438 \u043D\u0435 \u043D\u0430\u0445\u043E\u0434\u0438\u0442 \u043D\u0438\u0447\u0435\u0433\u043E \u2014 \u043F\u0440\u0438\u0445\u043E\u0434\u0438\u043B\u043E\u0441\u044C \u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0441 \u0441\u0430\u0439\u0442\u0430
 * \u0446\u0435\u043B\u0438\u043A\u043E\u043C (\u0418\u0440\u0438\u043D\u0430 \u0413\u043E\u0440\u0434\u0435\u0435\u0432\u0430 22.10.2026). \u0412\u0438\u0442\u0440\u0438\u043D\u0430 \u043D\u0435 \u043D\u0430\u0448\u0430, \u0447\u0438\u043D\u0438\u0442\u044C \u0442\u0430\u043C \u043D\u0435\u0447\u0435\u0433\u043E:
 * \u0441\u0440\u0430\u0432\u043D\u0438\u0432\u0430\u0435\u043C \u0442\u0430\u043A, \u0447\u0442\u043E\u0431\u044B \u043D\u0430\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u043D\u0435 \u0440\u0435\u0448\u0430\u043B\u043E.
 */
const LOOKALIKES: Array<[string, string]> = [
    ['A', '\u0410'], ['B', '\u0412'], ['C', '\u0421'], ['E', '\u0415'], ['H', '\u041D'], ['K', '\u041A'], ['M', '\u041C'],
    ['O', '\u041E'], ['P', '\u0420'], ['T', '\u0422'], ['X', '\u0425'], ['Y', '\u0423'],
    ['a', '\u0430'], ['c', '\u0441'], ['e', '\u0435'], ['o', '\u043E'], ['p', '\u0440'], ['x', '\u0445'], ['y', '\u0443'],
];

/** \u0411\u0443\u043A\u0432\u044B, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u043C\u043E\u0433\u0443\u0442 \u0431\u044B\u0442\u044C \u043D\u0430\u043F\u0438\u0441\u0430\u043D\u044B \u0438 \u0442\u0430\u043A \u0438 \u0442\u0430\u043A \u2014 \u0432 \u043E\u0431\u0440\u0430\u0437\u0446\u0435 \u0434\u043B\u044F \u0431\u0430\u0437\u044B \u043E\u043D\u0438 \u0441\u0442\u0430\u043D\u043E\u0432\u044F\u0442\u0441\u044F \u00AB_\u00BB. */
const CONFUSABLE_CHARS = new Set(
    LOOKALIKES.flatMap(([latin, cyrillic]) => [latin, cyrillic, latin.toLowerCase(), cyrillic.toLowerCase()]),
);

export function foldLookalikes(text: string): string {
    let out = String(text ?? '');
    for (const [latin, cyrillic] of LOOKALIKES) out = out.split(latin).join(cyrillic);
    return out;
}

/** \u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0438\u043B\u0438 \u0437\u0430\u043F\u0440\u043E\u0441 \u0432 \u0441\u0440\u0430\u0432\u043D\u0438\u043C\u043E\u043C \u0432\u0438\u0434\u0435: \u0442\u0438\u0440\u0435 \u043E\u0431\u044B\u0447\u043D\u044B\u0435, \u0434\u0432\u043E\u0439\u043D\u0438\u043A\u0438 \u0440\u0443\u0441\u0441\u043A\u0438\u0435, \u0441\u0442\u0440\u043E\u0447\u043D\u044B\u0435 \u0431\u0443\u043A\u0432\u044B. */
export function normalizeForMatch(text: string): string {
    return foldLookalikes(normalizeDashes(text)).toLowerCase();
}

/**
 * Образец для поиска, которому всё равно, какие знаки стоят между словами.
 *
 * Требование владельца 06.10.2026: «сделай фильтр, чтобы он не обращал
 * внимания на тире и другие знаки препинания». В каталоге одна и та же модель
 * пишется по-разному — «РШС–ВД», «РШС-ВД», «РШС ВД», «РШС.ВД», — и менеджер
 * не обязан угадывать. Каждый знак в образце становится «%»: на его месте
 * подойдёт что угодно, в том числе ничего.
 *
 * Сами символы образца, значимые для сравнения («%» и «_»), экранируем —
 * иначе введённый процент превратился бы в «найди что угодно».
 */
export function looseLike(part: string): string {
    return normalizeDashes(String(part ?? ''))
        // Экранируем только то, что значимо для сравнения и не является знаком
        // препинания: сам «%» и обратный слэш. Подчёркивание — обычный знак,
        // оно становится подстановкой наравне с дефисом и точкой.
        .replace(/[\\%]/g, (ch) => `\\${ch}`)
        .replace(/[^a-zа-яё0-9\\%]+/gi, '%');
}

/**
 * Тот же образец, но буквам-двойникам всё равно, каким алфавитом их набрали.
 *
 * Каждая такая буква становится «_» — одним любым знаком. База сравнивает
 * побуквенно и про алфавиты не знает, поэтому иначе «ШСО 02» русскими буквами
 * не нашло бы «ШСO 02» с латинской «O». Образец получается шире, и выдачу
 * после него обязательно просеиваем у себя (`matchesAllParts`).
 */
export function confusableLike(part: string): string {
    return looseLike(part)
        .split('')
        .map((ch) => (CONFUSABLE_CHARS.has(ch) ? '_' : ch))
        .join('');
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

    /**
     * Слова от трёх знаков — и ОТДЕЛЬНО числа, даже двузначные.
     *
     * Жалоба Ирины Гордеевой 20.10.2026: «поиск не ищет по обозначению, что
     * стеллаж именно на 12 пар нужен, а он есть у нас». На запрос «сушильный
     * стеллаж вираж эконом на 12 пар» выдавались стеллажи на 10 пар: «12»
     * короче трёх знаков, и поиск выбрасывал его целиком — искал «стеллаж
     * вираж эконом пар». Количество пар — это и есть обозначение изделия,
     * терять его нельзя.
     *
     * Предлоги («на», «из», «от») отсеиваются по-прежнему: они не цифры и
     * короче трёх знаков.
     */
    const words = text
        .split(/[^a-zа-яё0-9]+/i)
        .filter((word) => (word.length >= 3 || /^\d+$/.test(word))
            && !models.some((model) => model.includes(word)));

    return { models: Array.from(new Set(models)).slice(0, 4), words: Array.from(new Set(words)).slice(0, 6) };
}

/**
 * То же сравнение, что и `looseLike`, но у себя в памяти.
 *
 * Нужно, чтобы посчитать, насколько строка отвечает запросу, уже ПОСЛЕ выборки:
 * база отдаёт совпадения, а порядок выдачи решаем мы.
 *
 * Буквенные классы написаны явно ([а-яё]): `\w` и `\b` в JS кириллицу не
 * видят, и правило молча не срабатывало бы на русских названиях.
 */
function looseRegex(part: string): RegExp {
    const body = normalizeForMatch(part)
        .split(/[^a-zа-яё0-9]+/i)
        .filter(Boolean)
        .map((chunk) => {
            const safe = chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            /**
             * Число из запроса ищем числом целиком, а не куском другого числа.
             *
             * «20 пар» находило «2200х1250х515» и «2050х1975х680»: «20» входит
             * в габариты почти любого изделия. Поиск показывал стеллажи на 40,
             * 48, 72 и 90 пар и молчал о том, что двадцати среди них нет —
             * менеджер считал это ответом на свой запрос (Ирина Гордеева
             * 22.10.2026). Теперь сказанное число либо есть, либо его нет.
             */
            return /^\d+$/.test(chunk) ? `(?<!\\d)${safe}(?!\\d)` : safe;
        })
        .join('[^a-zа-яё0-9]*');
    return new RegExp(body || '(?!)', 'i');
}

/** Все ли куски запроса действительно есть в названии. */
function matchesAllParts(name: string, parts: string[]): boolean {
    const folded = normalizeForMatch(name);
    return parts.every((part) => looseRegex(part).test(folded));
}

/**
 * Где ищем совпадения: название, артикул и названия модификаций.
 *
 * Размер изделия живёт не в названии карточки, а в её модификациях: у
 * «Сушильный стеллаж SL1 Вираж-Эконом. Односторонний» есть «На 12 пар обуви»,
 * «На 16 пар обуви», «На 21 пару обуви». Если смотреть только на название,
 * «на 12 пар» не находится нигде, хотя товар на витрине есть (жалобы Ирины
 * Гордеевой 20 и 22.10.2026).
 */
function searchHaystack(row: any): string {
    const skus = Array.isArray(row?.raw_data?.skus) ? row.raw_data.skus : [];
    return [
        String(row?.name ?? ''),
        String(row?.sku ?? ''),
        ...skus.map((sku: any) => `${sku?.name ?? ''} ${sku?.sku ?? ''}`),
    ].join(' ');
}

/**
 * Порядок выдачи поиска.
 *
 * Жалоба владельца 15.10.2026: «вводим ЛВЖ 1200 и выдаёт кучу ненужного».
 * Причина была не в совпадениях, а в их отсутствии: ЛВЖ с 1200 в каталоге нет
 * вовсе, поиск молча отбрасывал «1200», брал `limit(15)` БЕЗ сортировки — то
 * есть первые пятнадцать строк в порядке базы — и выдавал их как ответ на
 * запрос. Наверху оказывались карточки без цены и снятые с витрины.
 *
 * Теперь сортируем сами:
 *   1. живое вперёд — опубликовано на сайте и с ценой;
 *   2. точное вхождение запроса целиком;
 *   3. сколько слов запроса нашлось;
 *   4. по названию — чтобы список был одинаковым при каждом заходе, а не
 *      случайным.
 */
function rankCatalogRows(rows: any[], query: string, parts: string[], take: number): any[] {
    const whole = looseRegex(query);
    const partRes = parts.map((part) => looseRegex(part));

    const scored = rows.map((row) => {
        const name = normalizeForMatch(String(row.name ?? ''));
        // Совпадения считаем и по модификациям: размер изделия написан в них.
        const haystack = normalizeForMatch(searchHaystack(row));
        const matched = partRes.reduce((sum, re) => sum + (re.test(haystack) ? 1 : 0), 0);
        return {
            row,
            name,
            matched,
            // Снятое с витрины и карточки без цены — вниз, но из выдачи не
            // убираем: товар, которого нет на сайте, продать всё равно можно
            // (решение владельца 15.10.2026).
            dead: String(row.meta?.status ?? '') === '1' && Number(row.price) > 0 ? 0 : 1,
            exact: whole.test(name) ? 1 : 0,
        };
    });

    scored.sort((a, b) =>
        a.dead - b.dead
        || b.exact - a.exact
        || b.matched - a.matched
        || a.name.localeCompare(b.name, 'ru'));

    // Один товар одной строкой: в каталоге по три копии карточки (ЗМКТЛТ-4501
    // лежит трижды, две из них сняты с витрины) — в выдаче это «куча».
    const seen = new Set<string>();
    const unique: any[] = [];
    for (const hit of scored) {
        const key = `${hit.name}|${Number(hit.row.price) || 0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(hit);
    }

    return unique.slice(0, take).map((hit) => hit.row);
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
        const search = async (parts: string[], tolerateLookalikes = false) => {
            if (!parts.length) return [] as any[];
            let request = client()
                .from('marketing_products')
                .select('id, sku, name, price, full_url, category_id, meta, raw_data');
            // Знаки препинания в образце — подстановочными: в каталоге на их
            // месте бывает длинное тире, пробел или ничего.
            /**
             * База сужает по словам, числа проверяем у себя.
             *
             * Размер («20 пар») в названии карточки обычно не написан — он в
             * модификациях, а по ним база искать не умеет. Поэтому числа из
             * запроса в условие к базе не ставим, зато ниже требуем их наличия
             * в названии, артикуле или модификации.
             */
            const words = parts.filter((part) => !/^\d+$/.test(part));
            const askDatabase = words.length ? words : parts;
            for (const part of askDatabase) {
                request = request.ilike('name', `%${tolerateLookalikes ? confusableLike(part) : looseLike(part)}%`);
            }
            // С запасом: пятнадцать строк выбирает ранжирование, а не порядок базы.
            const { data, error } = await request.limit(askDatabase.length === parts.length ? 200 : 500);
            if (error) throw new Error(error.message);
            /**
             * Что отдала база — просеиваем у себя: образец нарочно шире
             * сказанного (знаки и буквы-двойники стоят подстановками), а
             * показывать надо только то, где есть ВСЁ названное.
             */
            return ((data ?? []) as any[]).filter((row) => matchesAllParts(searchHaystack(row), parts));
        };

        /**
         * Одна попытка — два образца: как набрано и терпимо к буквам-двойникам.
         *
         * Оба нужны вместе, а не по очереди: на «ШСО-02» точный образец находит
         * «Шкаф сушильной шсо - 02- 39п», и если на этом остановиться, «Шкаф
         * сушильный ШСO 02 (1880х820х620мм)» с латинской «O» так и не покажется
         * — а менеджеру нужен был именно он.
         */
        const searchBoth = async (parts: string[]) => {
            const [exact, tolerant] = await Promise.all([search(parts), search(parts, true)]);
            const seen = new Set(exact.map((row) => String(row.id)));
            return [...exact, ...tolerant.filter((row) => !seen.has(String(row.id)))];
        };

        const attempts: string[][] = [];
        /**
         * Сначала — запрос целиком, как написан.
         *
         * Знаки между словами уже не важны (looseLike), поэтому «РШС ВД»,
         * «РШС-ВД» и «РШС.ВД» ищут одно и то же, а порядок слов сохраняется:
         * «Шкаф сушильный РШС-3-6 ЗМК Комфорт» находит именно его, а не
         * РШС-3-20, который раньше выходил первым. Не нашлось — идём дальше,
         * к попыткам по частям.
         */
        const whole = normalizeDashes(query).trim();
        if (whole.length >= 4 && /[^a-zа-яё0-9]/i.test(whole)) attempts.push([whole]);
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
            rows = await searchBoth(parts);
            if (rows.length) break;
        }

        if (!rows.length) {
            // Последняя попытка — «ИЛИ», как раньше, но с большой выборкой и
            // ранжированием по числу совпавших слов.
            const all = [...models, ...words];
            const or = all.map((part) => `name.ilike.%${confusableLike(part)}%`).join(',');
            const { data, error } = await client()
                .from('marketing_products')
                .select('id, sku, name, price, full_url, category_id, meta, raw_data')
                .or(or)
                .limit(500);
            if (error) throw new Error(error.message);

            rows = (data ?? []).filter((row: any) =>
                all.some((part) => looseRegex(part).test(normalizeForMatch(String(row.name ?? '')))));
        }

        const allParts = [...models, ...words];
        rows = rankCatalogRows(rows, query, allParts, take);

        /**
         * Запрос пришлось ослабить — говорим об этом вслух.
         *
         * Раньше отбрасывание слова было молчаливым: на «ЛВЖ 1200» менеджер
         * видел пятнадцать ЛВЖ-шкафов и считал, что это и есть «ЛВЖ 1200».
         * Теперь в окне написано, по чему на самом деле показан список
         * (жалоба владельца 15.10.2026).
         */
        // По чему показан список — считаем по верхней строке целиком, вместе с
        // её модификациями: размер написан в них, и объявлять его ненайденным
        // нельзя, если он там есть.
        const topName = rows.length ? normalizeForMatch(searchHaystack(rows[0])) : '';
        const matchedParts = allParts.filter((part) => looseRegex(part).test(topName));
        const missedParts = allParts.filter((part) => !matchedParts.includes(part));

        const cats = await resolveCategories(rows);
        return {
            found: rows.length,
            // Что из запроса не нашлось — по этому строится сообщение менеджеру.
            weakened: rows.length > 0 && missedParts.length > 0,
            usedQuery: matchedParts.join(' '),
            missedQuery: missedParts.join(' '),
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
