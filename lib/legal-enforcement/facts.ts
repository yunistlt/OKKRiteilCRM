// Черновик карточки и доказательство под каждым полем.
//
// Правило раздела: бот пишет ЧЕРНОВИК. В колонки карточки значение попадает само
// только когда извлекатель уверен (>= порога) и другого значения по этому полю нет.
// Всё спорное живёт в legal_enforcement_field_facts со state='suggested' и ждёт человека.
import { supabase } from '@/utils/supabase';
import {
  ENFORCEMENT_CONFIDENCE_REVIEW_THRESHOLD,
  ENFORCEMENT_FIELD_LABELS,
  parseAmountToKopecks,
  parseRuDate,
  type EnforcementStatus,
} from './types';
import type { ExtractedField } from './extract';

/** Колонки карточки, которые разрешено писать автоматически. */
const WRITABLE_COLUMNS = new Set(Object.keys(ENFORCEMENT_FIELD_LABELS));

export type SaveFactsResult = {
  saved: number;
  autoApplied: string[];
  needsReview: string[];
};

export async function saveExtractedFields(params: {
  caseId: number;
  documentId: number;
  fields: ExtractedField[];
}): Promise<SaveFactsResult> {
  const { caseId, documentId, fields } = params;
  if (fields.length === 0) return { saved: 0, autoApplied: [], needsReview: [] };

  const { data: caseRow } = await supabase
    .from('legal_enforcement_cases')
    .select('*')
    .eq('id', caseId)
    .maybeSingle();

  // Уже подтверждённые человеком факты неприкосновенны: бот их не перебивает.
  const { data: existingFacts } = await supabase
    .from('legal_enforcement_field_facts')
    .select('field, value_text, state')
    .eq('case_id', caseId);

  const confirmedFields = new Set(
    (existingFacts || []).filter((fact: any) => fact.state === 'confirmed').map((fact: any) => fact.field),
  );

  const rows: any[] = [];
  const autoApplied: string[] = [];
  const needsReview: string[] = [];
  const patch: Record<string, any> = {};

  // Сколько разных значений бот нашёл по каждому полю в этой пачке.
  const perFieldCount = new Map<string, number>();
  for (const field of fields) {
    perFieldCount.set(field.field, (perFieldCount.get(field.field) || 0) + 1);
  }

  for (const field of fields) {
    const conflicting = (existingFacts || []).find(
      (fact: any) =>
        fact.field === field.field &&
        fact.state !== 'rejected' &&
        String(fact.value_text || '').toLowerCase() !== field.value_text.toLowerCase(),
    );

    const ambiguous = (perFieldCount.get(field.field) || 0) > 1 || Boolean(conflicting);
    const confident = field.confidence >= ENFORCEMENT_CONFIDENCE_REVIEW_THRESHOLD && !ambiguous;
    const alreadyFilled = caseRow ? caseRow[field.field] !== null && caseRow[field.field] !== undefined : false;
    const canApply =
      confident && WRITABLE_COLUMNS.has(field.field) && !alreadyFilled && !confirmedFields.has(field.field);

    rows.push({
      case_id: caseId,
      document_id: documentId,
      field: field.field,
      value_text: field.value_text,
      value_raw: { value: field.value_raw },
      quote: field.quote,
      confidence: field.confidence,
      extractor: field.extractor,
      conflicts_with: conflicting ? `Другое значение по этому полю: «${conflicting.value_text}»` : null,
      // Автоприменённое поле всё равно остаётся «предложением»: человек видит его
      // в списке и может отклонить — иначе доказательство теряет смысл.
      state: 'suggested',
    });

    if (canApply) {
      patch[field.field] = field.value_raw ?? field.value_text;
      autoApplied.push(field.field);
    } else if (!confirmedFields.has(field.field)) {
      needsReview.push(field.field);
    }
  }

  const { error: insertError } = await supabase.from('legal_enforcement_field_facts').insert(rows);
  if (insertError) throw insertError;

  if (Object.keys(patch).length > 0) {
    const { error: patchError } = await supabase
      .from('legal_enforcement_cases')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', caseId);
    if (patchError) throw patchError;
  }

  return { saved: rows.length, autoApplied, needsReview };
}

/** Решение человека по одному факту: подтвердить (можно с правкой) или отклонить. */
export async function decideFact(params: {
  factId: number;
  decision: 'confirm' | 'reject';
  correctedValue?: string | null;
  userId: string;
}) {
  const { factId, decision, correctedValue, userId } = params;

  const { data: fact, error } = await supabase
    .from('legal_enforcement_field_facts')
    .select('id, case_id, field, value_text, value_raw')
    .eq('id', factId)
    .maybeSingle();
  if (error) throw error;
  if (!fact) throw new Error('Факт не найден');

  const now = new Date().toISOString();

  if (decision === 'reject') {
    await supabase
      .from('legal_enforcement_field_facts')
      .update({ state: 'rejected', confirmed_by: userId, confirmed_at: now })
      .eq('id', factId);
    return { case_id: fact.case_id, field: fact.field, applied: null };
  }

  const valueText = correctedValue?.trim() || String(fact.value_text || '');
  const valueRaw = correctedValue?.trim()
    ? normalizeByField(fact.field, valueText)
    : (fact.value_raw as any)?.value ?? valueText;

  // Одно поле — одно действующее значение: прежние предложения гасим.
  await supabase
    .from('legal_enforcement_field_facts')
    .update({ state: 'superseded' })
    .eq('case_id', fact.case_id)
    .eq('field', fact.field)
    .in('state', ['suggested', 'confirmed'])
    .neq('id', factId);

  const confirmPatch: Record<string, any> = {
    state: 'confirmed',
    value_text: valueText,
    value_raw: { value: valueRaw },
    confirmed_by: userId,
    confirmed_at: now,
  };
  // Исправил человек — так и пишем: источник значения больше не бот.
  if (correctedValue?.trim()) confirmPatch.extractor = 'human';

  await supabase.from('legal_enforcement_field_facts').update(confirmPatch).eq('id', factId);

  if (WRITABLE_COLUMNS.has(fact.field)) {
    await supabase
      .from('legal_enforcement_cases')
      .update({ [fact.field]: valueRaw, updated_at: now })
      .eq('id', fact.case_id);
  }

  return { case_id: fact.case_id, field: fact.field, applied: valueRaw };
}

function normalizeByField(field: string, valueText: string): any {
  if (field.endsWith('_kopecks')) return parseAmountToKopecks(valueText);
  if (field === 'started_on' || field.startsWith('debt_period')) return parseRuDate(valueText) || valueText;
  return valueText;
}

/**
 * Статус карточки по фактам, а не по кнопке: пока по разобранным полям остаются
 * непросмотренные предложения — карточка «нужна проверка».
 */
export async function recalcCaseStatus(caseId: number): Promise<EnforcementStatus> {
  const { data: caseRow } = await supabase
    .from('legal_enforcement_cases')
    .select('status, parse_status')
    .eq('id', caseId)
    .maybeSingle();

  if (!caseRow) throw new Error('Карточка не найдена');
  // Закрытую и учтённую в отчёте карточку пересчёт не двигает.
  if (caseRow.status === 'closed' || caseRow.status === 'in_fd_report') return caseRow.status as EnforcementStatus;

  const [{ count: suggestedCount }, { count: confirmedCount }, { count: linkedPayments }] = await Promise.all([
    supabase
      .from('legal_enforcement_field_facts')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .eq('state', 'suggested'),
    supabase
      .from('legal_enforcement_field_facts')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .eq('state', 'confirmed'),
    supabase
      .from('legal_enforcement_payment_links')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', caseId)
      .eq('link_state', 'confirmed'),
  ]);

  let next: EnforcementStatus = 'docs_uploaded';
  if (caseRow.parse_status === 'completed') next = 'parsed';
  if ((suggestedCount || 0) > 0) next = 'needs_review';
  else if ((confirmedCount || 0) > 0) next = 'confirmed';
  if ((linkedPayments || 0) > 0 && (suggestedCount || 0) === 0) next = 'payments_linked';

  if (next !== caseRow.status) {
    await supabase
      .from('legal_enforcement_cases')
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq('id', caseId);
  }

  return next;
}
