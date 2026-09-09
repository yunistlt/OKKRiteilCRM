/**
 * Общий фильтр списка платежей «с точки»: вкладка (проект/статус/разбор) + период по дате платежа.
 * Используется и списком (`/api/payments/list`), и выгрузкой (`/api/payments/export`),
 * чтобы выгрузка всегда совпадала с тем, что видно на экране.
 */

export type PaymentsListFilter = {
  status: string | null;
  project: string | null;
  review: boolean;
  dateFrom: string | null;
  dateTo: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Разбор query-параметров фильтра (невалидные даты игнорируются). */
export function parsePaymentsListFilter(searchParams: URLSearchParams): PaymentsListFilter {
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  return {
    status: searchParams.get('status'),
    project: searchParams.get('project'),
    review: Boolean(searchParams.get('review')),
    dateFrom: from && DATE_RE.test(from) ? from : null,
    dateTo: to && DATE_RE.test(to) ? to : null,
  };
}

/** Только период — для сводок по вкладкам (они считаются без фильтра вкладки). */
export function applyPaymentsPeriod(query: any, filter: PaymentsListFilter) {
  let q = query;
  if (filter.dateFrom) q = q.gte('payment_date', filter.dateFrom);
  if (filter.dateTo) q = q.lte('payment_date', filter.dateTo);
  return q;
}

/** Период + вкладка. */
export function applyPaymentsListFilter(query: any, filter: PaymentsListFilter) {
  let q = applyPaymentsPeriod(query, filter);
  if (filter.review) {
    // Столярка/консалтинг не требуют разбора (опознаны, живут в своих вкладках).
    return q.eq('status', 'pending_match').or('project.is.null,project.eq.zmktl');
  }
  if (filter.status) q = q.eq('status', filter.status);
  if (filter.project) q = q.eq('project', filter.project);
  return q;
}
