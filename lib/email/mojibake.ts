/**
 * Письма, которые врут о своей кодировке.
 *
 * Заказ 53005, письмо «Отзыв: [#2/53005]» (27.10.2026): тело помечено
 * `charset="koi8-r"`, а байты на деле в windows-1251 — тема в том же письме
 * как раз 1251 и читается верно. Разборщик честно верит заголовку, и в
 * карточке заказа человек видит «оНКЭГНБЮРЕКЭ лЮПЬЕБЮ» вместо «Пользователь
 * Маршева». Такие письма шлёт Outlook, когда отзывает сообщение.
 *
 * Чиним по результату, а не по заголовку: перекодируем текст обратно и
 * смотрим, какой вариант больше похож на русский. Сомневаемся — оставляем как
 * есть: испортить живое письмо хуже, чем оставить одно нечитаемое.
 */
import iconv from 'iconv-lite';

/**
 * Частые русские пары букв.
 *
 * Словарь слов для этой задачи не годится: на длинном письме каша случайно
 * набирает коротких совпадений («в», «и», «с») больше, чем живой текст — 24
 * против 16 на проверке 27.10.2026, и починка ломала нормальные письма. Пары
 * букв устойчивее: в каше сочетания неестественные, и доля знакомых падает
 * в разы.
 */
const COMMON_PAIRS = new Set([
    'ст', 'но', 'то', 'на', 'ен', 'ов', 'ни', 'ра', 'во', 'ко', 'ро', 'по', 'не', 'ли', 'ль',
    'ал', 'ер', 'та', 'ре', 'ом', 'ог', 'ел', 'ет', 'ка', 'ле', 'ат', 'го', 'ти', 'те', 'ес',
    'ор', 'ан', 'ск', 'ин', 'ри', 'ми', 'ла', 'ос', 'ис', 'да', 'ас', 'ва', 'ар', 'ед', 'ит',
    'ме', 'ся', 'им', 'ны', 'ия', 'од', 'ак', 'ьн', 'ди', 'ую', 'ей', 'ие', 'ем', 'ав', 'ши',
]);

/** Насколько «по-русски» выглядит текст: доля знакомых пар букв, 0…1. */
function russianScore(text: string): number {
    // \w и \b с кириллицей не работают — режем по явному классу.
    const letters = String(text ?? '').toLowerCase().replace(/[^а-яё]+/g, ' ').trim();
    if (letters.length < 12) return 0;

    let pairs = 0;
    let known = 0;
    for (let i = 0; i < letters.length - 1; i += 1) {
        const pair = letters.slice(i, i + 2);
        if (pair.includes(' ')) continue;
        pairs += 1;
        if (COMMON_PAIRS.has(pair)) known += 1;
    }

    return pairs ? known / pairs : 0;
}

/** Та же строка, прочитанная как другая однобайтовая кодировка. */
function reread(text: string, wrote: string, meant: string): string | null {
    try {
        const bytes = iconv.encode(text, wrote);
        const back = iconv.decode(bytes, meant);

        // Непредставимый символ iconv заменяет вопросительным знаком: такая
        // перекодировка уже потеряла часть текста, и брать её нельзя.
        const lost = (back.match(/\?/g) ?? []).length - (text.match(/\?/g) ?? []).length;
        if (lost > 0 || back.includes('�')) return null;

        return back;
    } catch {
        return null;
    }
}

/**
 * Насколько кандидат должен выиграть, чтобы менять текст.
 *
 * Живые письма тоже бывают «негладкими» — подпись, название компании капсом,
 * латиница вперемешку. Заметный отрыв отсекает такие случаи: у настоящей каши
 * разрыв кратный, а не на пару процентов.
 */
const WIN_BY = 0.2;

/**
 * Вернуть текст в читаемом виде.
 *
 * Пробуем две путаницы, которые и встречаются в русской почте: письмо
 * объявило koi8-r, а внутри windows-1251, и наоборот.
 */
export function fixCharsetMojibake(text: string | null | undefined): string | null {
    const source = text == null ? null : String(text);
    if (!source || !/[А-Яа-яЁё]/.test(source)) return source;

    let best = source;
    let bestScore = russianScore(source) + WIN_BY;

    for (const [wrote, meant] of [['koi8-r', 'win1251'], ['win1251', 'koi8-r']]) {
        const candidate = reread(source, wrote, meant);
        if (!candidate) continue;

        const score = russianScore(candidate);
        if (score > bestScore) {
            best = candidate;
            bestScore = score;
        }
    }

    return best;
}
