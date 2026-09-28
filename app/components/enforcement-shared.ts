// Общее для реестра и карточки исполнительных производств: типы строк и
// человеческое отображение значений. Коды в интерфейс не выпускаем (ЗАКОН).
import { ENFORCEMENT_GROUND_LABELS } from '@/lib/legal-enforcement/types';

export type EnforcementCase = Record<string, any> & {
  id: number;
  status: string;
  pending_facts?: number;
  documents_count?: number;
  is_sample?: boolean;
};

export type Fact = {
  id: number;
  document_id: number | null;
  field: string;
  value_text: string | null;
  quote: string | null;
  confidence: number | null;
  extractor: string;
  conflicts_with: string | null;
  state: string;
  confirmed_by: string | null;
};

export type Doc = {
  id: number;
  title: string | null;
  file_name: string;
  doc_kind: string | null;
  upload_status: string;
  scan_status: string;
  extract_status: string;
  extract_warnings: any;
  raw_text: string | null;
  raw_text_length: number;
};

export type PaymentRow = {
  id: number;
  amount_kopecks: number;
  payment_date: string | null;
  purpose: string | null;
  payer_name: string | null;
  payer_inn: string | null;
};

export type PaymentLink = {
  id: number;
  payment_id: number;
  link_state: string;
  match_reason: { reasons?: string[] } | null;
  confidence: number | null;
};

export const ENFORCEMENT_STATUS_STYLES: Record<string, string> = {
  docs_uploaded: 'bg-gray-100 text-gray-700',
  parsed: 'bg-indigo-100 text-indigo-800',
  needs_review: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  payments_linked: 'bg-teal-100 text-teal-800',
  in_fd_report: 'bg-blue-100 text-blue-800',
  closed: 'bg-gray-200 text-gray-600',
};

export const PROJECT_LABELS: Record<string, string> = {
  zmktl: 'ЗМКТЛ',
  stolyarka: 'Столярка',
  consulting: 'ПО/Консалтинг',
};

export function formatMoney(kopecks: number | null | undefined) {
  if (kopecks === null || kopecks === undefined) return '—';
  return (Number(kopecks) / 100).toLocaleString('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 2,
  });
}

/**
 * Дату печатаем только тогда, когда это действительно дата в формате ISO.
 * Всё прочее отдаём как есть: «2 квартал 2026» через new Date() давало
 * «Invalid Date», а «01.04.2026» — 4 января, потому что JS читает такую
 * строку по-американски. Показанная задом наперёд дата хуже неформатированной.
 */
export function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const raw = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString('ru-RU');
  }

  return raw;
}

export function humanFieldValue(field: string, value: any) {
  if (value === null || value === undefined || value === '') return '—';
  if (field.endsWith('_kopecks')) {
    // В карточке суммы лежат числом в копейках, а в предложениях бота — строкой
    // как в документе («1 250 000,00»). Число форматируем, строку показываем
    // как есть: Number('1 250 000,00') даёт NaN, и на экране было «не число ₽».
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(/[\s\u00a0]/g, '').replace(',', '.'));
    return Number.isFinite(numeric) ? formatMoney(numeric) : String(value);
  }
  if (field === 'started_on' || field.startsWith('debt_period')) return formatDate(String(value));
  if (field === 'ground') {
    return ENFORCEMENT_GROUND_LABELS[value as keyof typeof ENFORCEMENT_GROUND_LABELS] || String(value);
  }
  return String(value);
}
