// Подбор платежей к исполнительному производству.
//
// ВАЖНО ПРО ДАННЫЕ: `point_payments` сегодня хранит только ПРИХОД — и Точка, и Т-Банк
// пишут в базу лишь входящие операции (`lib/payments/tbank.ts`, `tochka-statement.ts`).
// Списание по исполнительному производству — расход, и его в базе физически нет.
// Поэтому подбор написан и работает, но до включения расходов в загрузку выписки он
// почти всегда вернёт пусто. Раздел об этом честно говорит в интерфейсе.
import { supabase } from '@/utils/supabase';

export type PaymentSuggestion = {
  payment_id: number;
  amount_kopecks: number;
  payment_date: string | null;
  purpose: string | null;
  counterparty: string | null;
  counterparty_inn: string | null;
  confidence: number;
  reasons: string[];
};

function normInn(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const left = new Date(a).getTime();
  const right = new Date(b).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Math.abs(Math.round((left - right) / 86400000));
}

/**
 * Признаки связи: номер ИП в назначении, номер листа/приказа, сумма, дата, ИНН,
 * слова про ФССП/приставов. Одного признака мало — привязываем только от двух,
 * как в матчинге платежей на заказы.
 */
export async function suggestPaymentsForCase(caseId: number): Promise<PaymentSuggestion[]> {
  const { data: caseRow, error } = await supabase
    .from('legal_enforcement_cases')
    .select('id, case_number, writ_number, court_case_number, debtor_inn, claimant_inn, claimant_name, debt_amount_kopecks, charge_amount_kopecks, started_on')
    .eq('id', caseId)
    .maybeSingle();
  if (error) throw error;
  if (!caseRow) throw new Error('Карточка не найдена');

  const tokens = [caseRow.case_number, caseRow.writ_number, caseRow.court_case_number]
    .map((value) => String(value || '').trim())
    .filter((value) => value.length >= 4);

  const amounts = [caseRow.debt_amount_kopecks, caseRow.charge_amount_kopecks]
    .map((value) => (value === null || value === undefined ? null : Number(value)))
    .filter((value): value is number => Number.isFinite(value as number));

  // Кандидаты: по номеру в назначении, по ИНН взыскателя, по сумме.
  const candidates = new Map<number, any>();

  const collect = (rows: any[] | null) => {
    for (const row of rows || []) candidates.set(Number(row.id), row);
  };

  const columns = 'id, amount_kopecks, payment_date, purpose, payer_name, payer_inn, status';

  for (const token of tokens) {
    const { data } = await supabase
      .from('point_payments')
      .select(columns)
      .ilike('purpose', `%${token}%`)
      .limit(20);
    collect(data);
  }

  if (normInn(caseRow.claimant_inn)) {
    const { data } = await supabase
      .from('point_payments')
      .select(columns)
      .eq('payer_inn', normInn(caseRow.claimant_inn))
      .limit(20);
    collect(data);
  }

  for (const amount of amounts) {
    const { data } = await supabase
      .from('point_payments')
      .select(columns)
      .eq('amount_kopecks', amount)
      .limit(20);
    collect(data);
  }

  // Явные «приставские» назначения — их стоит показать даже без номера.
  const { data: fsspLike } = await supabase
    .from('point_payments')
    .select(columns)
    .or('purpose.ilike.%пристав%,purpose.ilike.%ФССП%,purpose.ilike.%исполнительн%')
    .limit(30);
  collect(fsspLike);

  const suggestions: PaymentSuggestion[] = [];

  for (const payment of Array.from(candidates.values())) {
    const reasons: string[] = [];
    const purpose = String(payment.purpose || '');

    for (const token of tokens) {
      if (purpose.toLowerCase().includes(token.toLowerCase())) {
        reasons.push(`номер «${token}» в назначении платежа`);
      }
    }

    if (amounts.includes(Number(payment.amount_kopecks))) {
      reasons.push('сумма совпадает с суммой из карточки');
    }

    if (normInn(caseRow.claimant_inn) && normInn(payment.payer_inn) === normInn(caseRow.claimant_inn)) {
      reasons.push('ИНН стороны платежа совпал с взыскателем');
    }

    if (/пристав|фссп|исполнительн/i.test(purpose)) {
      reasons.push('в назначении упомянуты приставы/исполнительное производство');
    }

    const gap = daysBetween(payment.payment_date, caseRow.started_on);
    if (gap !== null && gap <= 45) {
      reasons.push(`дата платежа в ${gap} дн. от даты возбуждения`);
    }

    if (reasons.length === 0) continue;

    suggestions.push({
      payment_id: Number(payment.id),
      amount_kopecks: Number(payment.amount_kopecks || 0),
      payment_date: payment.payment_date || null,
      purpose: payment.purpose || null,
      counterparty: payment.payer_name || null,
      counterparty_inn: payment.payer_inn || null,
      // Один признак — только показать человеку, два и больше — можно предлагать связь.
      confidence: Math.min(0.95, 0.3 + 0.2 * reasons.length),
      reasons,
    });
  }

  suggestions.sort((a, b) => b.confidence - a.confidence || b.amount_kopecks - a.amount_kopecks);
  return suggestions.slice(0, 20);
}

/** Пишет предложения в legal_enforcement_payment_links (state='suggested'). */
export async function persistSuggestions(caseId: number, suggestions: PaymentSuggestion[]) {
  if (suggestions.length === 0) return 0;

  const rows = suggestions.map((item) => ({
    case_id: caseId,
    payment_id: item.payment_id,
    link_state: 'suggested',
    match_reason: { reasons: item.reasons },
    confidence: item.confidence,
  }));

  // Решённые связи не переписываем — только добавляем новые предложения.
  const { data: existing } = await supabase
    .from('legal_enforcement_payment_links')
    .select('payment_id')
    .eq('case_id', caseId);
  const known = new Set((existing || []).map((row: any) => Number(row.payment_id)));
  const fresh = rows.filter((row) => !known.has(row.payment_id));
  if (fresh.length === 0) return 0;

  const { error } = await supabase.from('legal_enforcement_payment_links').insert(fresh);
  if (error) throw error;
  return fresh.length;
}

export async function decidePaymentLink(params: {
  caseId: number;
  paymentId: number;
  decision: 'confirm' | 'reject';
  userId: string;
}) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('legal_enforcement_payment_links')
    .upsert(
      {
        case_id: params.caseId,
        payment_id: params.paymentId,
        link_state: params.decision === 'confirm' ? 'confirmed' : 'rejected',
        confirmed_by: params.userId,
        confirmed_at: now,
      },
      { onConflict: 'case_id,payment_id' },
    );
  if (error) throw error;
}

/**
 * Есть ли в базе расходные операции вообще. Нужно интерфейсу, чтобы не врать
 * пустым списком: «связей нет» и «расходов в базе нет» — разные сообщения.
 */
export async function outgoingPaymentsAvailable(): Promise<boolean> {
  const { count } = await supabase
    .from('point_payments')
    .select('id', { count: 'exact', head: true })
    .lt('amount_kopecks', 0);
  return (count || 0) > 0;
}
