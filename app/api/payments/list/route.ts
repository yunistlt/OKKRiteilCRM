import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';
import {
  applyPaymentsListFilter,
  applyPaymentsPeriod,
  parsePaymentsListFilter,
} from '@/lib/payments/list-filter';

export const dynamic = 'force-dynamic';

const LIST_COLUMNS =
  'id, source, external_payment_id, amount_kopecks, currency, payment_date, purpose, ' +
  'document_number, payer_name, payer_inn, recipient_name, recipient_inn, status, project, match_method, match_confidence, ' +
  'extracted_invoice_number, match_candidates, matched_order_number, matched_order_id, ' +
  'retailcrm_payment_id, retailcrm_synced_at, retailcrm_error, signature_verified, ' +
  'reviewed_by, reviewed_at, created_at';

// GET /api/payments/list?status=pending_match|project=zmktl&limit=100
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get('limit')) || 100, 500);

    // Фильтр вкладки + период — общий с выгрузкой (lib/payments/list-filter).
    const filter = parsePaymentsListFilter(searchParams);
    const applyPeriod = (q: any) => applyPaymentsPeriod(q, filter);
    const applyFilter = (q: any) => applyPaymentsListFilter(q, filter);

    const query = applyFilter(
      supabase
        .from('point_payments')
        .select(LIST_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(limit),
    );

    const { data, error } = await query;
    if (error) throw error;

    // «Итого по фильтру» — по всем платежам фильтра, а не только по загруженной странице.
    const { data: filteredAmounts, error: totalsError } = await applyFilter(
      supabase.from('point_payments').select('amount_kopecks').limit(20000),
    );
    if (totalsError) throw totalsError;
    const filteredTotal = {
      count: (filteredAmounts || []).length,
      amountKopecks: (filteredAmounts || []).reduce(
        (sum: number, r: any) => sum + (Number(r.amount_kopecks) || 0),
        0,
      ),
    };

    // Сводки по статусам и по проектам для вкладок (количество и сумма).
    const { data: counts } = await applyPeriod(
      supabase.from('point_payments').select('status, project, amount_kopecks').limit(20000),
    );
    const summary: Record<string, number> = {};
    const projectSummary: Record<string, number> = {};
    const summaryAmount: Record<string, number> = {};
    const projectSummaryAmount: Record<string, number> = {};
    let reviewCount = 0;
    let reviewAmount = 0;
    (counts || []).forEach((r: any) => {
      const kop = Number(r.amount_kopecks) || 0;
      summary[r.status] = (summary[r.status] || 0) + 1;
      summaryAmount[r.status] = (summaryAmount[r.status] || 0) + kop;
      if (r.project) {
        projectSummary[r.project] = (projectSummary[r.project] || 0) + 1;
        projectSummaryAmount[r.project] = (projectSummaryAmount[r.project] || 0) + kop;
      }
      if (r.status === 'pending_match' && (!r.project || r.project === 'zmktl')) {
        reviewCount++;
        reviewAmount += kop;
      }
    });

    const crmUrl = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');

    return NextResponse.json({
      payments: data || [],
      summary,
      projectSummary,
      reviewCount,
      summaryAmount,
      projectSummaryAmount,
      reviewAmount,
      filteredTotal,
      limit,
      crm_url: crmUrl,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
