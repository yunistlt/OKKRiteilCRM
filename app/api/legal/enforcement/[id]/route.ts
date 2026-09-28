// Карточка производства: поля, документы, доказательства под полями, связи с платежами.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { outgoingPaymentsAvailable } from '@/lib/legal-enforcement/payment-match';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const caseId = Number(params.id);
    if (!Number.isInteger(caseId) || caseId <= 0) {
      return NextResponse.json({ error: 'Неверный идентификатор карточки' }, { status: 400 });
    }

    const [{ data: caseRow, error }, { data: documents }, { data: facts }, { data: links }] = await Promise.all([
      supabase.from('legal_enforcement_cases').select('*').eq('id', caseId).maybeSingle(),
      supabase
        .from('legal_enforcement_documents')
        .select('id, title, file_name, doc_kind, upload_status, scan_status, extract_status, extract_warnings, created_at, raw_text')
        .eq('case_id', caseId)
        .order('created_at', { ascending: true }),
      supabase
        .from('legal_enforcement_field_facts')
        .select('*')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false }),
      supabase
        .from('legal_enforcement_payment_links')
        .select('id, payment_id, link_state, match_reason, confidence, confirmed_by, confirmed_at')
        .eq('case_id', caseId),
    ]);

    if (error) throw error;
    if (!caseRow) return NextResponse.json({ error: 'Карточка не найдена' }, { status: 404 });

    const paymentIds = (links || []).map((row: any) => Number(row.payment_id));
    let payments: any[] = [];
    if (paymentIds.length > 0) {
      const { data } = await supabase
        .from('point_payments')
        .select('id, amount_kopecks, payment_date, purpose, payer_name, payer_inn')
        .in('id', paymentIds);
      payments = data || [];
    }

    return NextResponse.json({
      case: caseRow,
      // Сырой текст OCR отдаём укороченным: он нужен как доказательство, а не как чтение.
      documents: (documents || []).map((doc: any) => ({
        ...doc,
        raw_text_length: doc.raw_text ? String(doc.raw_text).length : 0,
        raw_text: doc.raw_text ? String(doc.raw_text).slice(0, 4000) : null,
      })),
      facts: facts || [],
      payment_links: links || [],
      payments,
      outgoing_payments_available: await outgoingPaymentsAvailable(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось открыть карточку' }, { status: 500 });
  }
}
