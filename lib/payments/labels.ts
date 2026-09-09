/**
 * Человекочитаемые названия для платежей «с точки» (ЗАКОН: в интерфейсе и выгрузках — только они, не коды).
 * Один источник для страницы `/payments` и для выгрузки в Excel.
 */

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending_match: 'Требуют разбора',
  matched: 'Привязанные',
  manual: 'Привязаны вручную',
  recognized: 'Опознан',
  ignored: 'Пропущенные',
  failed: 'Ошибка',
};

export const PAYMENT_SOURCE_LABELS: Record<string, string> = {
  tochka: 'Точка',
  tbank: 'Т-Банк',
};

export const PAYMENT_PROJECT_LABELS: Record<string, string> = {
  zmktl: 'ЗМКТЛ',
  stolyarka: 'Столярка',
  consulting: 'ПО/Консалтинг',
};

export const PAYMENT_MATCH_METHOD_LABELS: Record<string, string> = {
  order_number: 'По номеру счёта',
  inn_amount_date: 'По ИНН и сумме',
  manual: 'Вручную',
};

export const PAYMENT_CONFIDENCE_LABELS: Record<string, string> = {
  high: 'Высокая',
  medium: 'Средняя',
  low: 'Низкая',
};
