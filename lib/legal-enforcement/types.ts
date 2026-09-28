// Исполнительные производства (ФССП): словари, схемы запросов, ярлыки.
//
// ЗАКОН проекта: в интерфейсе только человеческий язык, поэтому рядом с каждым
// техническим кодом здесь лежит русское название. Логика сравнивает коды.
import { z } from 'zod';

export const ENFORCEMENT_BUCKET = 'legal-enforcement';
export const ENFORCEMENT_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

// Принимаем в любом виде, в каком приходят документы от приставов: PDF, Word,
// скан-картинка и архив целиком. ZIP бот распаковывает сам — заставлять человека
// доставать файлы по одному значит, что он просто не будет их грузить.
export const ENFORCEMENT_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/octet-stream',
]);

/** Внутри архива разбираем только то, из чего умеем доставать текст. */
export const ENFORCEMENT_ARCHIVE_ENTRY_RE = /\.(pdf|docx?|txt|jpe?g|png|webp|tiff?)$/i;

export function isArchiveFile(contentType?: string | null, fileName?: string | null) {
  const type = String(contentType || '').toLowerCase();
  if (/zip|rar|7z|compressed/.test(type)) return true;
  return /\.(zip|rar|7z|tar|gz|tgz)$/i.test(String(fileName || ''));
}

/** Стадии карточки — ровно те, что просила Тамара. */
export const ENFORCEMENT_STATUSES = [
  'docs_uploaded',
  'parsed',
  'needs_review',
  'confirmed',
  'payments_linked',
  'in_fd_report',
  'closed',
] as const;
export type EnforcementStatus = (typeof ENFORCEMENT_STATUSES)[number];

export const ENFORCEMENT_STATUS_LABELS: Record<EnforcementStatus, string> = {
  docs_uploaded: 'Черновик',
  parsed: 'Бот разобрал',
  needs_review: 'Нужна проверка',
  confirmed: 'Подтверждено',
  payments_linked: 'Связано с платежами',
  in_fd_report: 'Учтено в ФД-отчёте',
  closed: 'Закрыто',
};

/** Основание взыскания. */
export const ENFORCEMENT_GROUNDS = [
  'tax',
  'court',
  'counterparty',
  'fine',
  'employee',
  'fund',
  'other',
] as const;
export type EnforcementGround = (typeof ENFORCEMENT_GROUNDS)[number];

export const ENFORCEMENT_GROUND_LABELS: Record<EnforcementGround, string> = {
  tax: 'Налог',
  court: 'Суд',
  counterparty: 'Контрагент',
  fine: 'Штраф',
  employee: 'Сотрудник',
  fund: 'Фонд',
  other: 'Иное',
};

/** Вид документа в карточке. */
export const ENFORCEMENT_DOC_KINDS = [
  'postanovlenie',
  'trebovanie',
  'reshenie',
  'prikaz',
  'list',
  'inkasso',
  'other',
] as const;
export type EnforcementDocKind = (typeof ENFORCEMENT_DOC_KINDS)[number];

export const ENFORCEMENT_DOC_KIND_LABELS: Record<EnforcementDocKind, string> = {
  postanovlenie: 'Постановление о возбуждении ИП',
  trebovanie: 'Требование об уплате',
  reshenie: 'Решение о взыскании',
  prikaz: 'Судебный приказ',
  list: 'Исполнительный лист',
  inkasso: 'Инкассовое поручение',
  other: 'Прочий документ',
};

/** Поля карточки, которые заполняет бот, и их русские названия для доказательств. */
export const ENFORCEMENT_FIELD_LABELS: Record<string, string> = {
  case_number: 'Номер исполнительного производства',
  started_on: 'Дата возбуждения',
  debtor_name: 'Должник',
  debtor_inn: 'ИНН должника',
  claimant_name: 'Взыскатель',
  claimant_inn: 'ИНН взыскателя',
  debt_amount_kopecks: 'Сумма долга',
  charge_amount_kopecks: 'Сумма взыскания',
  fssp_department: 'Отдел ФССП',
  bailiff_name: 'Пристав',
  ground: 'Основание',
  court_case_number: 'Номер дела суда',
  writ_number: 'Исполнительный лист / приказ',
  debt_period_from: 'Период долга, с',
  debt_period_to: 'Период долга, по',
  management_account: 'Управленческая статья',
};

/** Список полей, которые карточка принимает от извлекателя. */
export const ENFORCEMENT_EXTRACTABLE_FIELDS = Object.keys(ENFORCEMENT_FIELD_LABELS);

/** Ниже этой уверенности поле не подставляется молча — уходит человеку на проверку. */
export const ENFORCEMENT_CONFIDENCE_REVIEW_THRESHOLD = 0.75;

// --- Схемы запросов -------------------------------------------------------

export const enforcementCaseCreateSchema = z.object({
  debtor_inn: z.string().trim().regex(/^\d{10}(\d{2})?$/, 'ИНН должника — 10 или 12 цифр').optional().nullable(),
  debtor_name: z.string().trim().min(2).max(300).optional().nullable(),
  project: z.enum(['zmktl', 'stolyarka', 'consulting']).optional().nullable(),
  case_number: z.string().trim().min(3).max(120).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  /** Тестовый прогон: карточка видна, но подписана «ОБРАЗЕЦ» и не идёт в суммы. */
  is_sample: z.boolean().optional(),
});

/**
 * Ручная правка полей карточки.
 *
 * Бот разбирает документы и предлагает значения, человек их подтверждает — но там, где
 * бот не справился или в документе опечатка, поле нужно исправить руками. Правим ровно
 * те поля, что показаны в карточке; служебные (статус, кто подтвердил, пометка образца)
 * меняются своими методами, чтобы их нельзя было переписать мимо проверок.
 *
 * Пустая строка приходит как очистка поля: человек стёр значение осознанно.
 */
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optionalText = (max: number) =>
    z.preprocess(emptyToNull, z.string().trim().max(max).nullable().optional());
const optionalDate = () =>
    z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в виде ГГГГ-ММ-ДД').nullable().optional());
const optionalInn = () =>
    z.preprocess(emptyToNull, z.string().trim().regex(/^\d{10}(\d{2})?$/, 'ИНН — 10 или 12 цифр').nullable().optional());
/** Деньги храним в копейках, а вводит человек рубли — принимаем и то и другое написание. */
const optionalMoneyKopecks = () =>
    z.preprocess((v) => {
        // undefined — «поле не присылали», его нельзя равнять с «стереть»: иначе правка
        // одного поля обнулит суммы, а они уходят в ФД-отчёт.
        if (v === undefined) return undefined;
        if (v === null || (typeof v === 'string' && v.trim() === '')) return null;
        if (typeof v === 'number') return Math.round(v);
        const normalized = String(v).replace(/\s/g, '').replace(',', '.');
        const rubles = Number(normalized);
        return Number.isFinite(rubles) ? Math.round(rubles * 100) : v;
    }, z.number().int().nonnegative('Сумма не может быть отрицательной').nullable().optional());

export const enforcementCaseUpdateSchema = z.object({
    case_number: optionalText(120),
    started_on: optionalDate(),
    debtor_name: optionalText(300),
    debtor_inn: optionalInn(),
    claimant_name: optionalText(300),
    claimant_inn: optionalInn(),
    debt_amount_kopecks: optionalMoneyKopecks(),
    charge_amount_kopecks: optionalMoneyKopecks(),
    fssp_department: optionalText(300),
    bailiff_name: optionalText(200),
    ground: optionalText(500),
    court_case_number: optionalText(120),
    writ_number: optionalText(120),
    debt_period_from: optionalDate(),
    debt_period_to: optionalDate(),
    management_account: optionalText(200),
    note: optionalText(2000),
});

export type EnforcementCaseUpdate = z.infer<typeof enforcementCaseUpdateSchema>;

export const enforcementSampleToggleSchema = z.object({
  case_id: z.number().int().positive(),
  is_sample: z.boolean(),
});

export const enforcementDocumentUploadSchema = z.object({
  case_id: z.number().int().positive(),
  title: z.string().trim().min(3).max(200).optional().nullable(),
  file_name: z.string().trim().min(1).max(255),
  file_type: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => ENFORCEMENT_ALLOWED_MIME_TYPES.has(value), { message: 'Такой тип файла не принимаем' }),
  file_size: z.number().int().min(1).max(ENFORCEMENT_MAX_FILE_SIZE_BYTES),
});

export const enforcementDocumentCompleteSchema = z.object({
  document_id: z.number().int().positive(),
  upload_status: z.enum(['uploaded', 'failed']).default('uploaded'),
  error: z.string().trim().max(400).optional().nullable(),
});

export const enforcementParseSchema = z.object({
  case_id: z.number().int().positive(),
});

export const enforcementFactDecisionSchema = z.object({
  fact_id: z.number().int().positive(),
  decision: z.enum(['confirm', 'reject']),
  /** Правка человека: подтверждаем не то, что нашёл бот, а исправленное значение. */
  corrected_value: z.string().trim().max(500).optional().nullable(),
});

export const enforcementCaseStatusSchema = z.object({
  case_id: z.number().int().positive(),
  status: z.enum(ENFORCEMENT_STATUSES),
  closed_reason: z.string().trim().max(500).optional().nullable(),
});

export const enforcementPaymentLinkSchema = z.object({
  case_id: z.number().int().positive(),
  payment_id: z.number().int().positive(),
  decision: z.enum(['confirm', 'reject']),
});

export function sanitizeEnforcementFileName(fileName: string) {
  const sanitized = fileName
    .normalize('NFKC')
    .replace(/[\\/]/g, '-')
    .replace(/[^a-zA-Z0-9._()\-\sа-яА-ЯёЁ]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized.slice(0, 140) || 'document';
}

export function buildEnforcementStoragePath(caseId: number, fileName: string) {
  return `${caseId}/${Date.now()}_${sanitizeEnforcementFileName(fileName)}`;
}

/** Копейки из суммы вида «1 234,56» / «1234.56». */
export function parseAmountToKopecks(raw: string): number | null {
  const normalized = raw
    .replace(/ /g, '')
    .replace(/\s/g, '')
    .replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/** Дата из «12.03.2026» или «12 марта 2026» в ISO. */
const RU_MONTHS: Record<string, string> = {
  январ: '01', феврал: '02', март: '03', апрел: '04', ма: '05', июн: '06',
  июл: '07', август: '08', сентябр: '09', октябр: '10', ноябр: '11', декабр: '12',
};

export function parseRuDate(raw: string): string | null {
  const dotted = raw.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (dotted) {
    const [, d, m, y] = dotted;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const worded = raw.match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  if (worded) {
    const [, d, monthWord, y] = worded;
    const key = Object.keys(RU_MONTHS).find((prefix) => monthWord.toLowerCase().startsWith(prefix));
    if (key) return `${y}-${RU_MONTHS[key]}-${d.padStart(2, '0')}`;
  }

  return null;
}
