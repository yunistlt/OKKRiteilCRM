// Идентификация проекта платежа и маршрут уведомления в Telegram.
//
// У бизнеса 3 проекта на любых юрлицах — получатель НЕ определяет проект:
//   • ЗМКТЛ       — металлоконструкции/стеллажи, заказы ведутся в RetailCRM (zmktlt);
//   • Столярка    — деревянная/детская мебель, в RetailCRM НЕ ведётся;
//   • Консалтинг  — ПО/внедрение (Цех-Успех), в этом RetailCRM НЕ ведётся.
//
// Проект определяем по НАЗНАЧЕНИЮ платежа (ключевые слова). «Чужой» проект (столярка/
// консалтинг) имеет приоритет над совпадением с заказом RetailCRM — чтобы столярный/
// консалтинговый счёт, случайно совпавший по номеру с заказом ЗМКТЛ, не был привязан к
// нему и не уехал в чат ЗМК.
//
// Ключевые слова редактируются через env (…_KEYWORDS, через запятую), иначе — дефолт ниже.
// Чаты — env: TELEGRAM_PAYMENTS_CHAT_ID (ЗМКТЛ), TELEGRAM_PROJECT_STOLYARKA_CHAT,
// TELEGRAM_PROJECT_CONSULTING_CHAT.

export type ProjectKey = 'zmktl' | 'stolyarka' | 'consulting';
export type ForeignProject = 'stolyarka' | 'consulting';

export const PROJECT_NAMES: Record<ProjectKey, string> = {
  zmktl: 'ЗМКТЛ',
  stolyarka: 'Столярка',
  consulting: 'Консалтинг',
};

const DEFAULT_KEYWORDS: Record<ForeignProject, string[]> = {
  // Деревянная/детская мебель (не путать с металлическими стеллажами ЗМКТЛ).
  stolyarka: [
    'столярк', 'берёз', 'берез', 'дуб', 'ясен', 'бук', 'массив', 'фанер', 'дерев',
    'стульчик', 'кормящ', 'klapp', 'kids', 'мебель', 'детск', 'комод', 'кроват',
    'пеленаль', 'манеж', 'табурет', 'качел',
  ],
  // ПО/внедрение/сопровождение (Цех-Успех).
  consulting: [
    'цех-успех', 'цех успех', 'цехуспех', 'внедрен', 'абонент', 'подписк', 'лиценз',
    'доработк', 'консалт', 'консультац', 'программн', 'по для', 'срм', 'crm',
    'автоматизац', 'сопровожден', 'обучен', 'настройк систем',
  ],
};

function keywordsFor(key: ForeignProject): string[] {
  const raw = process.env[`TELEGRAM_PROJECT_${key.toUpperCase()}_KEYWORDS`];
  if (raw && raw.trim()) {
    return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  return DEFAULT_KEYWORDS[key];
}

/**
 * Определяет «чужой» проект по назначению платежа. Консалтинг проверяем раньше столярки.
 * null — признаков чужого проекта нет (считаем ЗМКТЛ).
 */
export function detectForeignProject(purpose: string | null | undefined): ForeignProject | null {
  const p = (purpose || '').toLowerCase();
  if (!p) return null;
  if (keywordsFor('consulting').some((k) => p.includes(k))) return 'consulting';
  if (keywordsFor('stolyarka').some((k) => p.includes(k))) return 'stolyarka';
  return null;
}

/** Chat_id проекта (undefined, если не сконфигурирован). */
export function projectChatId(key: ProjectKey): string | undefined {
  if (key === 'stolyarka') return process.env.TELEGRAM_PROJECT_STOLYARKA_CHAT;
  if (key === 'consulting') return process.env.TELEGRAM_PROJECT_CONSULTING_CHAT;
  return process.env.TELEGRAM_PAYMENTS_CHAT_ID; // ЗМКТЛ — чат по умолчанию
}
