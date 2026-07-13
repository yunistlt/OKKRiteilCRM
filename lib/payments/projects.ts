// Идентификация проекта платежа и маршрут уведомления в Telegram.
//
// 3 проекта на любых юрлицах группы. Правила (по приоритету):
//   • ЗМКТЛ       — счёт совпал с заказом RetailCRM (задаётся при матчинге, project='zmktl');
//   • Столярка    — маркетплейс (Ozon/«Интернет Решения»/«по реестру»/«упл. комис») ИЛИ
//                   товар в назначении (мебель/Klapp/стульчик/берёза);
//   • Консалтинг  — получатель = ИП Теренков (632101044652) ИЛИ ключевые слова ПО/услуги.
//
// Внутренний перевод между своими юрлицами (оба ИНН — из группы) — не проект (в «Пропущено»).
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

// Маркетплейс-выплаты (Ozon и пр.) — это выручка столярки.
const MARKETPLACE_RE =
  /интернет решени|уч\.?\s*упл\.?\s*комис|по реестру|озон|ozon|wildberries|вайлдберриз|маркетплейс|яндекс\s*маркет/i;

const DEFAULT_KEYWORDS: Record<ForeignProject, string[]> = {
  stolyarka: [
    'столярк', 'берёз', 'берез', 'дуб', 'ясен', 'бук', 'массив', 'фанер', 'дерев',
    'стульчик', 'кормящ', 'klapp', 'kids', 'мебель', 'детск', 'комод', 'кроват',
    'пеленаль', 'манеж', 'табурет', 'качел',
  ],
  consulting: [
    'цех-успех', 'цех успех', 'цехуспех', 'внедрен', 'абонент', 'подписк', 'лиценз',
    'доработк', 'консалт', 'консультац', 'программ', 'доступ к по', 'доступа к по',
    'по за', 'срм', 'crm', 'автоматизац', 'сопровожден', 'услуг',
  ],
};

function keywordsFor(key: ForeignProject): string[] {
  const raw = process.env[`TELEGRAM_PROJECT_${key.toUpperCase()}_KEYWORDS`];
  if (raw && raw.trim()) return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return DEFAULT_KEYWORDS[key];
}

/** Перевод между своими юрлицами группы (оба ИНН — свои). Не платёж клиента. */
export function isInternalGroupTransfer(
  payerInn: string | null | undefined,
  recipientInn: string | null | undefined,
): boolean {
  const p = normInn(payerInn);
  const r = normInn(recipientInn);
  return Boolean(p && r && OWN_INNS.has(p) && OWN_INNS.has(r));
}

export interface ProjectSignals {
  purpose?: string | null;
  recipientInn?: string | null;
}

/**
 * «Чужой» проект (не ЗМКТЛ) по назначению/получателю. Приоритет:
 * маркетплейс → столярка; ИП-получатель или ключи ПО → консалтинг; товар → столярка.
 */
export function detectForeignProject(s: ProjectSignals): ForeignProject | null {
  const p = (s.purpose || '').toLowerCase();
  if (MARKETPLACE_RE.test(p)) return 'stolyarka';
  if (normInn(s.recipientInn) === CONSULTING_INN || keywordsFor('consulting').some((k) => p.includes(k))) {
    return 'consulting';
  }
  if (keywordsFor('stolyarka').some((k) => p.includes(k))) return 'stolyarka';
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
