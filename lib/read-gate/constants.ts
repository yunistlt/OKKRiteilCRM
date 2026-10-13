/** Причины отсрочки. Отдельный файл: список нужен и серверу, и странице. */
export const DEFER_REASONS = ['Клиент на линии', 'Встреча', 'Другое'] as const;
export type DeferReason = (typeof DEFER_REASONS)[number];
