import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const LIST_COLUMNS =
  'id, source, external_payment_id, amount_kopecks, currency, payment_date, purpose, ' +
  'document_number, payer_name, payer_inn, recipient_name, recipient_inn, status, match_method, match_confidence, ' +
  'extracted_invoice_number, match_candidates, matched_order_number, matched_order_id, ' +
  'retailcrm_payment_id, retailcrm_synced_at, retailcrm_error, signature_verified, ' +
  'reviewed_by, reviewed_at, created_at';

// GET /api/payments/list?status=pending_match&limit=100
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const limit = Math.min(Number(searchParams.get('limit')) || 100, 500);

    let query = supabase
      .from('point_payments')
      .select(LIST_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    // Сводка по статусам для шапки.
    const { data: counts } = await supabase
      .from('point_payments')
      .select('status')
      .limit(2000);
    const summary: Record<string, number> = {};
    (counts || []).forEach((r: any) => {
      summary[r.status] = (summary[r.status] || 0) + 1;
    });

    const crmUrl = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL || '').replace(/\/+$/, '');

    return NextResponse.json({ payments: data || [], summary, crm_url: crmUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
