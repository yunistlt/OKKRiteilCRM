// Идентификация проекта платежа и маршрут уведомления в Telegram.
//
// 3 проекта на любых юрлицах группы. Правила (по приоритету):
//   • ЗМКТЛ       — счёт совпал с заказом RetailCRM (задаётся при матчинге, project='zmktl');
//   • Столярка    — маркетплейс (Ozon/«Интернет Решения»/«по реестру»/«упл. комис») ИЛИ
//                   товар в назначении (мебель/Klapp/стульчик/берёза);
//   • Консалтинг  — получатель = ИП Теренков (632101044652) ИЛИ ключевые слова ПО/услуги.
//
// Платёж от своего юрлица группы (ИНН плательщика — наш) — не проект (в «Пропущено»).
//
// ENV (все опциональны, дефолты ниже):
//   TELEGRAM_PAYMENTS_CHAT_ID (ЗМКТЛ), TELEGRAM_PROJECT_STOLYARKA_CHAT, TELEGRAM_PROJECT_CONSULTING_CHAT
//   PAYMENT_OWN_INNS (ИНН своих юрлиц), PAYMENT_CONSULTING_INN (ИП консалтинга)
//   TELEGRAM_PROJECT_STOLYARKA_KEYWORDS / _CONSULTING_KEYWORDS

export type ProjectKey = 'zmktl' | 'stolyarka' | 'consulting';
export type ForeignProject = 'stolyarka' | 'consulting';

export const PROJECT_NAMES: Record<ProjectKey, string> = {
  zmktl: 'ЗМКТЛ',
  stolyarka: 'Столярка',
  consulting: 'ПО/Консалтинг',
};

function normInn(v: string | null | undefined): string {
  return String(v || '').replace(/\D/g, '');
}

// ИНН своих юрлиц: ЗМК, ПОБТ, ИП Теренков, ЗВТО, Теренков Инвестиции.
const OWN_INNS = new Set(
  (process.env.PAYMENT_OWN_INNS || '6324017492,6321277326,632101044652,1674010590,6320082677')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

// Консалтинг/ПО billed через ИП Теренков.
const CONSULTING_INN = normInn(process.env.PAYMENT_CONSULTING_INN || '632101044652');

// ООО «ЗМК» — юрлицо проекта ЗМКТЛ (заказы RetailCRM).
const ZMK_INN = normInn(process.env.PAYMENT_ZMK_INN || '6324017492');

// Маркетплейс-выплаты (Ozon и пр.) — это выручка столярки.
const MARKETPLACE_RE =
  /интернет решени|уч\.?\s*упл\.?\s*комис|по реестру|озон|ozon|wildberries|вайлдберриз|маркетплейс|яндекс\s*маркет/i;

// ИНН маркетплейсов-плательщиков: 7704217370 — ООО «Интернет Решения» (Ozon).
const MARKETPLACE_INNS = new Set(
  (process.env.PAYMENT_MARKETPLACE_INNS || '7704217370')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const DEFAULT_KEYWORDS: Record<ForeignProject, string[]> = {
  stolyarka: [
    'столярк', 'берёз', 'берез', 'дуб', 'ясен', 'бук', 'массив', 'фанер', 'дерев',
    'стульчик', 'кормящ', 'klapp', 'kids', 'мебель', 'детск', 'комод', 'кроват',
    'пеленаль', 'манеж', 'табурет', 'качел',
  ],
  consulting: [
    'цех-успех', 'цех успех', 'цехуспех', 'внедрен', 'абонент', 'подписк', 'лиценз',
    'доработк', 'консалт', 'консультац', 'программ', 'доступ к по', 'доступа к по',
    'срм', 'crm', 'автоматизац', 'сопровожден', 'услуг',
  ],
};

// Ключ ищем как начало СЛОВА, а не подстроку в середине: иначе «доплата ПО ЗАказу»
// ловилась ключом «по за» и уезжала в чат консалтинга (инцидент 2026-08-04, платёж 6650).
function matchesKeyword(purpose: string, key: string): boolean {
  const re = new RegExp(`(^|[^0-9a-zа-яё])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  return re.test(purpose);
}

// Явная ссылка на заказ RetailCRM в назначении — это ЗМКТЛ, каким бы ни было остальное.
const ORDER_REF_RE = /заказ[а-я]*\s*№/i;

function keywordsFor(key: ForeignProject): string[] {
  const raw = process.env[`TELEGRAM_PROJECT_${key.toUpperCase()}_KEYWORDS`];
  if (raw && raw.trim()) return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return DEFAULT_KEYWORDS[key];
}

/** ИНН из списка своих юрлиц группы. */
export function isOwnInn(inn: string | null | undefined): boolean {
  const v = normInn(inn);
  return Boolean(v && OWN_INNS.has(v));
}

/**
 * Перевод внутри группы. Отсекаем ТОЛЬКО по ИНН плательщика: если платит своё юрлицо —
 * это не клиентские деньги, каким бы ни было назначение и известен ли получатель.
 * (ИНН получателя у Точки проставляется обогащением по счёту и может отсутствовать —
 * инцидент 2026-08-25: автораспределение по фондам ушло уведомлениями в чат.)
 */
export function isInternalGroupTransfer(payerInn: string | null | undefined): boolean {
  return isOwnInn(payerInn);
}

export interface ProjectSignals {
  purpose?: string | null;
  recipientInn?: string | null;
  /** Плательщик: у маркетплейсов признак только в названии/ИНН, назначение обезличено. */
  payerName?: string | null;
  payerInn?: string | null;
}

/**
 * «Чужой» проект (не ЗМКТЛ) по назначению/получателю. Приоритет:
 * маркетплейс → столярка; ИП-получатель или ключи ПО → консалтинг; товар → столярка.
 */
export function detectForeignProject(s: ProjectSignals): ForeignProject | null {
  const p = (s.purpose || '').toLowerCase();
  const inn = normInn(s.recipientInn);
  // Маркетплейс ищем и в плательщике: Ozon платит «за тов. по дог. …» без опознавательных
  // слов в назначении, вся зацепка — название/ИНН плательщика (инцидент 2026-08-10, платёж 7633).
  const payer = (s.payerName || '').toLowerCase();
  if (MARKETPLACE_RE.test(p) || MARKETPLACE_RE.test(payer) || MARKETPLACE_INNS.has(normInn(s.payerInn))) {
    return 'stolyarka';
  }
  // Получатель — ООО «ЗМК» либо в назначении есть «заказ №»: это ЗМКТЛ, в чужой проект
  // по ключевым словам не уводим.
  if (inn === ZMK_INN || ORDER_REF_RE.test(p)) return null;
  if (inn === CONSULTING_INN || keywordsFor('consulting').some((k) => matchesKeyword(p, k))) {
    return 'consulting';
  }
  if (keywordsFor('stolyarka').some((k) => matchesKeyword(p, k))) return 'stolyarka';
  return null;
}

/**
 * Итоговый проект платежа. matchedToOrder=true (счёт совпал с заказом RetailCRM) → ЗМКТЛ.
 * Иначе — по detectForeignProject; null — не определён (по умолчанию ЗМКТЛ в разборе).
 */
export function classifyProject(s: ProjectSignals, matchedToOrder: boolean): ProjectKey | null {
  if (matchedToOrder) return 'zmktl';
  return detectForeignProject(s);
}

/** Chat_id проекта (undefined, если не сконфигурирован). */
export function projectChatId(key: ProjectKey): string | undefined {
  if (key === 'stolyarka') return process.env.TELEGRAM_PROJECT_STOLYARKA_CHAT;
  if (key === 'consulting') return process.env.TELEGRAM_PROJECT_CONSULTING_CHAT;
  return process.env.TELEGRAM_PAYMENTS_CHAT_ID;
}
