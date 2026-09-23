/**
 * Подготовка текста к озвучке (TTS).
 *
 * Обратная задача к `lib/format.ts`: тот приводит числа к виду для ГЛАЗА
 * («2 140 000 ₽»), а здесь мы приводим их к виду для УХА («два миллиона сто
 * сорок тысяч рублей»). Silero читает цифры заметно хуже слов — проверено
 * прослушиванием, поэтому нормализация обязательна, а не украшение.
 *
 * Модуль чистый: ни сети, ни БД, ни env — только строки.
 */

const UNITS_M = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const UNITS_F = ['ноль', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
    'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят',
    'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот',
    'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

/** Разряды: [ед., 2-4, 5+], род разряда. */
const SCALES: Array<{ forms: [string, string, string]; feminine: boolean }> = [
    { forms: ['', '', ''], feminine: false },
    { forms: ['тысяча', 'тысячи', 'тысяч'], feminine: true },
    { forms: ['миллион', 'миллиона', 'миллионов'], feminine: false },
    { forms: ['миллиард', 'миллиарда', 'миллиардов'], feminine: false },
];

/** Выбор формы слова по числу: 1 заказ / 2 заказа / 5 заказов. */
export function plural(n: number, forms: [string, string, string]): string {
    const abs = Math.abs(Math.trunc(n));
    const mod100 = abs % 100;
    if (mod100 >= 11 && mod100 <= 19) return forms[2];
    const mod10 = abs % 10;
    if (mod10 === 1) return forms[0];
    if (mod10 >= 2 && mod10 <= 4) return forms[1];
    return forms[2];
}

/** Триада 0..999 словами. */
function tripletToWords(n: number, feminine: boolean): string[] {
    const out: string[] = [];
    const h = Math.floor(n / 100);
    const rest = n % 100;
    if (h > 0) out.push(HUNDREDS[h]);
    if (rest >= 10 && rest <= 19) {
        out.push(TEENS[rest - 10]);
    } else {
        const t = Math.floor(rest / 10);
        const u = rest % 10;
        if (t > 0) out.push(TENS[t]);
        if (u > 0) out.push(feminine ? UNITS_F[u] : UNITS_M[u]);
    }
    return out;
}

/**
 * Целое число словами. `feminine` задаёт род последнего разряда
 * («одна тысяча», но «один заказ»).
 */
export function intToWordsRu(value: number, feminine = false): string {
    let n = Math.trunc(value);
    if (!Number.isFinite(n)) return '';
    const prefix = n < 0 ? ['минус'] : [];
    n = Math.abs(n);
    if (n === 0) return [...prefix, 'ноль'].join(' ');

    // Раскладываем на триады, младшая первой.
    const triplets: number[] = [];
    let rest = n;
    while (rest > 0) {
        triplets.push(rest % 1000);
        rest = Math.floor(rest / 1000);
    }
    if (triplets.length > SCALES.length) return String(value); // за миллиардами не идём

    const words: string[] = [];
    for (let i = triplets.length - 1; i >= 0; i -= 1) {
        const t = triplets[i];
        if (t === 0) continue;
        const scale = SCALES[i];
        // Род: у разряда свой (тысяча — женский), у младшей триады — заданный извне.
        words.push(...tripletToWords(t, i === 0 ? feminine : scale.feminine));
        if (i > 0) words.push(plural(t, scale.forms));
    }
    return [...prefix, ...words].join(' ');
}

/**
 * Число с дробной частью: «три целых пять десятых».
 *
 * Разряд выбираем по тому, сколько знаков реально написано: «3,5» — десятые,
 * «3,05» — сотые. Иначе «три целых пятьдесят сотых» вместо «пять десятых».
 */
function decimalToWordsRu(value: number, feminine = false): string {
    const whole = Math.trunc(Math.abs(value));
    const frac = Math.abs(value) - whole;
    if (frac < 1e-9) return intToWordsRu(value, feminine);
    const sign = value < 0 ? 'минус ' : '';
    const tenths = Math.round(frac * 10);
    // Одного знака достаточно — читаем десятыми.
    if (Math.abs(frac * 10 - tenths) < 1e-9 && tenths > 0 && tenths < 10) {
        return `${sign}${intToWordsRu(whole, true)} ${plural(whole, ['целая', 'целых', 'целых'])} `
            + `${intToWordsRu(tenths, true)} ${plural(tenths, ['десятая', 'десятых', 'десятых'])}`;
    }
    const cents = Math.round(frac * 100);
    if (cents === 0) return intToWordsRu(value, feminine);
    return `${sign}${intToWordsRu(whole, true)} ${plural(whole, ['целая', 'целых', 'целых'])} `
        + `${intToWordsRu(cents, true)} ${plural(cents, ['сотая', 'сотых', 'сотых'])}`;
}

/** Сумма в рублях словами: «два миллиона сто сорок тысяч рублей». */
export function rublesToWordsRu(value: number): string {
    const whole = Math.trunc(Math.abs(value));
    const kop = Math.round((Math.abs(value) - whole) * 100);
    const sign = value < 0 ? 'минус ' : '';
    const parts = [`${intToWordsRu(whole)} ${plural(whole, ['рубль', 'рубля', 'рублей'])}`];
    if (kop > 0) {
        parts.push(`${intToWordsRu(kop, true)} ${plural(kop, ['копейка', 'копейки', 'копеек'])}`);
    }
    return sign + parts.join(' ');
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/**
 * День месяца в родительном падеже: «двадцать третьего».
 *
 * Именно родительный, а не именительный: в отчётах дата почти всегда стоит
 * после предлога («за неделю с 21 сентября», «отчёт за 23 сентября»), где
 * «двадцать третье сентября» звучит неграмотно.
 */
const DAY_ORDINAL: Record<number, string> = {
    1: 'первого', 2: 'второго', 3: 'третьего', 4: 'четвёртого', 5: 'пятого',
    6: 'шестого', 7: 'седьмого', 8: 'восьмого', 9: 'девятого', 10: 'десятого',
    11: 'одиннадцатого', 12: 'двенадцатого', 13: 'тринадцатого', 14: 'четырнадцатого',
    15: 'пятнадцатого', 16: 'шестнадцатого', 17: 'семнадцатого', 18: 'восемнадцатого',
    19: 'девятнадцатого', 20: 'двадцатого', 21: 'двадцать первого', 22: 'двадцать второго',
    23: 'двадцать третьего', 24: 'двадцать четвёртого', 25: 'двадцать пятого',
    26: 'двадцать шестого', 27: 'двадцать седьмого', 28: 'двадцать восьмого',
    29: 'двадцать девятого', 30: 'тридцатого', 31: 'тридцать первого',
};

/** Последнее слово года в родительном падеже: 2025 -> «две тысячи двадцать пятого». */
const YEAR_TAIL_GEN: Record<string, string> = {
    'один': 'первого', 'два': 'второго', 'три': 'третьего', 'четыре': 'четвёртого',
    'пять': 'пятого', 'шесть': 'шестого', 'семь': 'седьмого', 'восемь': 'восьмого',
    'девять': 'девятого', 'десять': 'десятого', 'одиннадцать': 'одиннадцатого',
    'двенадцать': 'двенадцатого', 'тринадцать': 'тринадцатого',
    'четырнадцать': 'четырнадцатого', 'пятнадцать': 'пятнадцатого',
    'шестнадцать': 'шестнадцатого', 'семнадцать': 'семнадцатого',
    'восемнадцать': 'восемнадцатого', 'девятнадцать': 'девятнадцатого',
    'двадцать': 'двадцатого', 'тридцать': 'тридцатого', 'сорок': 'сорокового',
    'пятьдесят': 'пятидесятого', 'шестьдесят': 'шестидесятого',
    'семьдесят': 'семидесятого', 'восемьдесят': 'восьмидесятого',
    'девяносто': 'девяностого', 'сто': 'сотого',
};

/** Год словами в родительном падеже. */
function yearToWordsGen(year: number): string {
    const words = intToWordsRu(year).split(' ');
    const last = words[words.length - 1];
    const gen = YEAR_TAIL_GEN[last];
    if (!gen) return intToWordsRu(year);
    words[words.length - 1] = gen;
    return words.join(' ');
}

/** Пробелы-разделители разрядов, которые ставит `formatNumberRu`. */
const THIN_SPACES = /[   ]/g;

/**
 * Приводит текст отчёта к виду, пригодному для синтеза речи.
 *
 * Порядок правил важен: сначала самые «широкие» шаблоны (дата, сумма,
 * процент), потом одиночные числа — иначе «2 140 000 ₽» распадётся на
 * три отдельных числа ещё до того, как мы поймём, что это сумма.
 */
export function normalizeForSpeech(input: string): string {
    if (!input) return '';
    let text = input;

    // 1. Разметка: голосом её не передать, читать «звёздочка» не нужно.
    text = text
        .replace(/```[\s\S]*?```/g, ' ')          // блоки кода
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/^\s*[-•—]\s+/gm, '')            // маркеры списка
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // ссылки -> только текст

    // 2. Склеиваем разряды: «2 140 000» -> «2140000».
    text = text.replace(THIN_SPACES, ' ');
    text = text.replace(/(\d) (?=\d{3}\b)/g, '$1');
    text = text.replace(/(\d) (?=\d{3}(\D|$))/g, '$1');

    // 3. Даты ISO и ДД.ММ.ГГГГ -> «двадцать третье сентября».
    text = text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, y, mo, d) =>
        dateWords(Number(d), Number(mo), Number(y)));
    text = text.replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g, (_m, d, mo, y) =>
        dateWords(Number(d), Number(mo), Number(y)));

    // 4. Время «14:30» -> «четырнадцать тридцать».
    text = text.replace(/\b(\d{1,2}):(\d{2})\b/g, (_m, h, mi) =>
        `${intToWordsRu(Number(h))} ${Number(mi) === 0 ? 'ноль-ноль' : intToWordsRu(Number(mi))}`);

    // 5. Суммы: «2140000 ₽», «2140000 руб.», «2140000 р.»
    text = text.replace(/(-?\d+(?:[.,]\d+)?)\s*(?:₽|руб\.?|р\.)/gi, (_m, num) =>
        rublesToWordsRu(parseNum(num)));

    // 6. Проценты: «8%» -> «восемь процентов».
    text = text.replace(/(-?\d+(?:[.,]\d+)?)\s*%/g, (_m, num) => {
        const n = parseNum(num);
        return `${decimalToWordsRu(n)} ${plural(Math.trunc(n), ['процент', 'процента', 'процентов'])}`;
    });

    // 7. Номер заказа «№53971» — читаем цифрами по одной, иначе на слух
    //    «пятьдесят три тысячи девятьсот семьдесят один» не сверить с экраном.
    text = text.replace(/№\s*(\d+)/g, (_m, digits) =>
        'номер ' + String(digits).split('').map((d: string) => UNITS_M[Number(d)]).join(' '));

    // 8. Остальные одиночные числа.
    text = text.replace(/-?\d+(?:[.,]\d+)?/g, (m) => decimalToWordsRu(parseNum(m)));

    // 9. Схлопываем пробелы, которые наплодили замены.
    return text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function parseNum(raw: string): number {
    const n = Number(String(raw).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}

function dateWords(day: number, month: number, year: number): string {
    const d = DAY_ORDINAL[day] ?? intToWordsRu(day);
    const m = MONTHS_GEN[month - 1] ?? '';
    // Год произносим только если он не текущий — иначе в отчёте это шум.
    const isCurrentYear = year === new Date().getFullYear();
    const y = isCurrentYear ? '' : ` ${yearToWordsGen(year)} года`;
    return `${d} ${m}${y}`.trim();
}
