// Разбор писем «Электронного стража» картотеки арбитражных дел.
//
// Почему письма, а не запросы к сайту: kad.arbitr.ru закрыт антиботом (WASM
// подписывает поисковый запрос), автоматический поиск он не пускает — проверено
// 28.09.2026 с нашего IP и с VPS в Москве, ответ 451. «Страж» — штатный сервис
// самой картотеки: подписываешь ящик на ИНН, и она присылает уведомления сама.
//
// Разбор детерминированный, без ИИ: у писем стража устойчивая разметка, а
// придуманный номер дела хуже пропущенного письма.

/** Отправители уведомлений картотеки. Правится через COURT_WATCH_SENDERS. */
const DEFAULT_SENDERS = ['arbitr.ru', 'kad.arbitr.ru', 'pravo.tech'];

export function courtWatchSenders(): string[] {
  const raw = process.env.COURT_WATCH_SENDERS;
  if (!raw) return DEFAULT_SENDERS;
  return raw.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

/**
 * Письмо ли это от картотеки. Проверяем отправителя И содержимое: адрес стража
 * могут поменять, а ссылка на kad.arbitr.ru в теле остаётся.
 */
export function isCourtWatchEmail(params: {
  fromEmail?: string | null;
  subject?: string | null;
  body?: string | null;
}): boolean {
  const from = String(params.fromEmail || '').toLowerCase();
  const subject = String(params.subject || '').toLowerCase();
  const body = String(params.body || '');

  if (courtWatchSenders().some((sender) => from.endsWith(`@${sender}`) || from.endsWith(`.${sender}`))) return true;
  if (/электронн\w*\s+страж|картотек\w*\s+арбитражных\s+дел/i.test(subject)) return true;
  if (/kad\.arbitr\.ru/i.test(body) && /дел\w*\s*№|A\d{1,2}-\d+\/\d{4}|А\d{1,2}-\d+\/\d{4}/i.test(body)) return true;

  return false;
}

export type StrajCase = {
  case_number: string;
  kad_url: string | null;
  court_name: string | null;
  case_type: string | null;
  plaintiff: string | null;
  defendant: string | null;
  amount_kopecks: number | null;
  registered_on: string | null;
  event_on: string | null;
  event_text: string;
  doc_url: string | null;
  mentioned_inns: string[];
  raw_excerpt: string;
};

/**
 * Номер арбитражного дела: А55-12345/2026, латинская A тоже встречается.
 * Регулярку создаём на каждый вызов: глобальная помнит lastIndex между вызовами
 * и со второго письма начинала бы искать с середины текста. Границы слова \b не
 * ставим: для JS кириллическая «А» — несловесный символ, и \b рядом с ней не
 * срабатывает вовсе.
 */
function caseNumberRe() {
  return /([АA]\d{1,2}[-–]\d{1,7}\/\d{4})/g;
}

function toIsoDate(raw: string): string | null {
  const match = raw.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (!match) return null;
  const [, d, m, y] = match;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function amountToKopecks(raw: string): number | null {
  const normalized = raw.replace(/ /g, '').replace(/\s/g, '').replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

function section(text: string, caseNumber: string): string {
  // Кусок письма вокруг номера дела: в одном письме стража может быть несколько дел.
  const index = text.indexOf(caseNumber);
  if (index < 0) return text.slice(0, 1200);
  return text.slice(Math.max(0, index - 400), Math.min(text.length, index + 1200));
}

/**
 * Достаёт из письма все дела. Возвращает пустой массив, если номеров нет —
 * значит, письмо не о деле (реклама сервиса, смена условий и т.п.).
 */
export function parseStrajEmail(params: {
  subject?: string | null;
  body?: string | null;
  html?: string | null;
}): StrajCase[] {
  const text = [params.subject || '', params.body || '', params.html || '']
    .filter(Boolean)
    .join('\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]{2,}/g, ' ');

  const numbers = Array.from(new Set(Array.from(text.matchAll(caseNumberRe())).map((m) => m[1].replace('–', '-'))));
  if (numbers.length === 0) return [];

  return numbers.map((caseNumber) => {
    const chunk = section(text, caseNumber);

    const kadUrl = (chunk.match(/https?:\/\/kad\.arbitr\.ru\/[^\s"'<>)]+/i) || [])[0] || null;
    const docUrl = (chunk.match(/https?:\/\/kad\.arbitr\.ru\/Document\/[^\s"'<>)]+/i) || [])[0] || null;

    const court = (chunk.match(/(Арбитражный суд[^\n,;.]{0,80})/i) || [])[1] || null;

    const plaintiff = (chunk.match(/истец[^:\n]{0,15}[:\s]+([^\n;]{3,160})/i) || [])[1] || null;
    const defendant = (chunk.match(/ответчик[^:\n]{0,15}[:\s]+([^\n;]{3,160})/i) || [])[1] || null;

    const amountMatch = chunk.match(/(?:цена иска|сумма иска|сумма требований)[^\d]{0,20}([\d\s ]+(?:[.,]\d{2})?)/i);
    const amount = amountMatch ? amountToKopecks(amountMatch[1]) : null;

    const registered = (chunk.match(/(?:дата регистрации|зарегистрировано)[^\d]{0,20}(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})/i) || [])[1] || null;
    const eventDate = (chunk.match(/(\d{1,2}[.\/]\d{1,2}[.\/]\d{4})/) || [])[1] || null;

    const caseType = /банкрот/i.test(chunk)
      ? 'банкротное'
      : /административн/i.test(chunk)
        ? 'административное'
        : /гражданск/i.test(chunk)
          ? 'гражданское'
          : null;

    // Что именно случилось: берём строку с глаголом движения, иначе тему письма.
    const eventLine =
      (chunk.match(/([^\n]{0,180}(?:назначен\w*|принят\w*\s+к\s+производству|отложен\w*|решени\w*|определени\w*|постановлени\w*|прекращен\w*|оставлен\w*\s+без|удовлетворен\w*|отказан\w*|апелляц\w*|кассац\w*)[^\n]{0,180})/i) || [])[1] ||
      String(params.subject || '').trim() ||
      'движение по делу';

    const inns = Array.from(new Set(Array.from(chunk.matchAll(/\b(\d{10}|\d{12})\b/g)).map((m) => m[1])));

    return {
      case_number: caseNumber,
      kad_url: kadUrl,
      court_name: court ? court.replace(/\s+/g, ' ').trim() : null,
      case_type: caseType,
      plaintiff: plaintiff ? plaintiff.replace(/\s+/g, ' ').trim() : null,
      defendant: defendant ? defendant.replace(/\s+/g, ' ').trim() : null,
      amount_kopecks: amount,
      registered_on: registered ? toIsoDate(registered) : null,
      event_on: eventDate ? toIsoDate(eventDate) : null,
      event_text: eventLine.replace(/\s+/g, ' ').trim().slice(0, 500),
      doc_url: docUrl,
      mentioned_inns: inns,
      raw_excerpt: chunk.replace(/\s+/g, ' ').trim().slice(0, 1500),
    };
  });
}
