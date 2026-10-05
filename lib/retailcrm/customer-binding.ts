/**
 * Привязка заявки бота к карточке корпоративного клиента — чистая логика без CRM и БД.
 *
 * Правило (решение бизнеса, 12.09.2026, разбор ПромСтоун / заказ 54151):
 *   1. Совпал ИНН — привязать.
 *   2. ИНН нет, но совпали название компании И почта или телефон — привязать.
 *   3. Совпало только название или только контакт (или ничего) — карточку НЕ заводить,
 *      а написать менеджеру в комментарий заказа, что покупатель не определён: пусть создаст
 *      карточку вручную или привяжет заказ к существующей.
 *
 * Почему именно так. Почта или телефон сами по себе — ненадёжный ключ: общий ящик посредника
 * висит на десятках юрлиц (srpm@srpm.ru — 18 карточек: ПромСтоун, АТК, Макита, Озон Фарм…).
 * Название само по себе тоже не ключ — в CRM его пишут как угодно. А вот вместе они
 * однозначны: если у кандидата и то же название, и тот же контакт — это тот же клиент.
 * Заводить карточку по одному признаку — плодить дубли, из-за которых постоянный клиент
 * в зарплате выглядит «новым» (у ПромСтоун 8 карточек без ИНН).
 */

export type ContactKey = 'почта' | 'телефон';

export type CorporateCandidate = {
    id: number;
    /** Название карточки в CRM (nickName). */
    name: string | null;
    ordersCount: number;
    /** По каким контактам карточка нашлась. */
    matchedBy: ContactKey[];
};

/** Организационно-правовые формы — не часть названия, выкидываем целиком. */
const LEGAL_FORM_PHRASES = [
    'общество с ограниченной ответственностью',
    'публичное акционерное общество',
    'закрытое акционерное общество',
    'открытое акционерное общество',
    'непубличное акционерное общество',
    'акционерное общество',
    'индивидуальный предприниматель',
];
const LEGAL_FORM_TOKENS = new Set(['ооо', 'оао', 'зао', 'пао', 'нао', 'ао', 'ип', 'llc', 'ltd', 'inc']);
const CITY_MARKERS = new Set(['г', 'гор', 'город']);

/** Латиница, которую набивают вместо кириллицы («OOО «МАКИТА»» — две латинские O). */
const LATIN_TO_CYRILLIC: Record<string, string> = {
    a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у',
};

/**
 * Нормализовать название компании для сравнения: регистр, ё, кавычки, ОПФ, «г. Уфа»,
 * латинские двойники. Результат — сплошная строка без пробелов: «ООО "ПромСтоун"»,
 * «ООО «ПРОМСТОУН»», «ПромСтоун, г.Уфа» → «промстоун».
 */
export function normalizeCompanyName(raw: string | null | undefined): string {
    if (!raw) return '';
    let s = raw.toLowerCase().replace(/ё/g, 'е');
    s = s.replace(/[a-z]/g, (ch) => LATIN_TO_CYRILLIC[ch] ?? ch);
    for (const phrase of LEGAL_FORM_PHRASES) s = s.split(phrase).join(' ');
    // Всё, что не буква и не цифра, — разделитель (кавычки, точки, запятые, дефисы).
    s = s.replace(/[^a-zа-я0-9]+/gi, ' ');
    // «г уфа», «город тольятти» — адресный хвост, не название (\b с кириллицей не работает,
    // поэтому режем по токенам).
    const tokens: string[] = [];
    const words = s.split(' ').filter(Boolean);
    for (let i = 0; i < words.length; i++) {
        const t = words[i];
        if (CITY_MARKERS.has(t) && i + 1 < words.length) { i++; continue; }
        if (LEGAL_FORM_TOKENS.has(t)) continue;
        tokens.push(t);
    }
    return tokens.join('');
}

/** Телефон → 10 цифр без кода страны; короткие/нечитаемые → null. */
export function normalizePhone(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) return digits.slice(1);
    if (digits.length === 10) return digits;
    return null;
}

export type CustomerMatch = {
    /** Карточка, к которой привязываем (название + контакт совпали). */
    chosen: CorporateCandidate | null;
    /** Все карточки с тем же названием среди найденных по контактам. */
    sameName: CorporateCandidate[];
};

/**
 * Выбрать карточку по правилу «название + контакт». `candidates` — карточки, найденные
 * в CRM по почте/телефону заявки; из них берём те, чьё название совпадает с названием
 * из заявки. Дублей одного клиента в CRM много — берём самую «рабочую»: больше заказов,
 * при равенстве — старшую (меньший id).
 */
export function pickCustomerMatch(
    companyName: string | null | undefined,
    candidates: CorporateCandidate[]
): CustomerMatch {
    const wanted = normalizeCompanyName(companyName);
    // Слишком короткое название («ИП», «ООО») совпадёт с чем угодно — не сравниваем.
    if (wanted.length < 3) return { chosen: null, sameName: [] };
    const sameName = candidates
        .filter((c) => c.matchedBy.length > 0 && normalizeCompanyName(c.name) === wanted)
        .sort((a, b) => (b.ordersCount - a.ordersCount) || (a.id - b.id));
    return { chosen: sameName[0] ?? null, sameName };
}

/**
 * Комментарий менеджеру, когда покупатель не определился. Пишем, что именно совпало и с чем,
 * чтобы менеджер не искал руками. Слов «дубль»/«дубл» в тексте быть не должно: комментарий
 * заказа разбирается фильтром тендерных дублей, и заказ вылетел бы из премии.
 */
export function buildUnresolvedCustomerHint(params: {
    companyName?: string | null;
    hasEmail: boolean;
    hasPhone: boolean;
    /** Карточки, найденные по контактам (название не совпало). */
    byContact: CorporateCandidate[];
    /** Карточки, найденные по названию (контакт не совпал или его нет). */
    byName: CorporateCandidate[];
}): string {
    const known: string[] = [];
    if (params.companyName?.trim()) known.push(`название «${params.companyName.trim()}»`);
    if (params.hasEmail) known.push('почта');
    if (params.hasPhone) known.push('телефон');

    const lines: string[] = [];
    lines.push(
        '❗ Покупатель не определён — карточка клиента не создана. '
        + (known.length
            ? `В заявке есть только ${known.join(', ')}; для привязки нужен ИНН или название вместе с почтой/телефоном. `
            : 'В заявке нет ни названия, ни контактов. ')
        + 'Создайте карточку вручную или привяжите заказ к существующей.'
    );

    const fmt = (c: CorporateCandidate, why: string) =>
        `${c.id} «${c.name || 'без названия'}» — ${why}${c.ordersCount ? `, заказов: ${c.ordersCount}` : ''}`;
    const top = (list: CorporateCandidate[]) =>
        [...list].sort((a, b) => (b.ordersCount - a.ordersCount) || (a.id - b.id)).slice(0, 3);

    const similar: string[] = [];
    const nameNote = params.companyName?.trim() ? 'название другое' : 'название в заявке не распознано';
    for (const c of top(params.byContact)) {
        const verb = c.matchedBy.length > 1 ? 'совпали' : c.matchedBy[0] === 'почта' ? 'совпала' : 'совпал';
        similar.push(fmt(c, `${verb} ${c.matchedBy.join(' и ')}, ${nameNote}`));
    }
    const contactIds = new Set(params.byContact.map((c) => c.id));
    for (const c of top(params.byName.filter((c) => !contactIds.has(c.id)))) {
        similar.push(fmt(c, 'совпало название, контакт другой'));
    }
    if (similar.length) lines.push(`Похожие карточки: ${similar.join('; ')}.`);
    return lines.join('\n');
}
