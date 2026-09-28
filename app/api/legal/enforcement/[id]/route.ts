// Карточка производства: поля, документы, доказательства под полями, связи с платежами.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { outgoingPaymentsAvailable } from '@/lib/legal-enforcement/payment-match';
import { writeLegalAudit } from '@/lib/legal-audit';
import { enforcementCaseUpdateSchema } from '@/lib/legal-enforcement/types';

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

/**
 * Ручная правка полей карточки.
 *
 * Бот разбирает документы и предлагает значения, но там, где он не справился или в
 * самом документе опечатка, исправлять приходится человеку. До этого правки не было
 * вовсе: карточка открывалась только на чтение, и юрист упирался в тупик.
 *
 * Пишем только те поля, что реально изменились, и складываем в журнал юротдела «было →
 * стало»: в разделе, где числа идут в ФД-отчёт, молчаливая правка суммы недопустима.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const caseId = Number(params.id);
    if (!Number.isInteger(caseId) || caseId <= 0) {
      return NextResponse.json({ error: 'Неверный идентификатор карточки' }, { status: 400 });
    }

    const parsed = enforcementCaseUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path?.[0] ? String(issue.path[0]) : null;
      return NextResponse.json(
        { error: field ? `${issue.message} (поле: ${field})` : issue?.message || 'Проверьте запрос' },
        { status: 400 },
      );
    }

    const { data: before, error: readError } = await supabase
      .from('legal_enforcement_cases')
      .select('*')
      .eq('id', caseId)
      .maybeSingle();
    if (readError) throw readError;
    if (!before) return NextResponse.json({ error: 'Карточка не найдена' }, { status: 404 });

    // Сравниваем с текущим значением: незачем писать в журнал поля, которых не трогали.
    const changes: Record<string, { was: any; became: any }> = {};
    const patch: Record<string, any> = {};

    for (const [field, value] of Object.entries(parsed.data)) {
      if (value === undefined) continue;
      const current = (before as any)[field] ?? null;
      const next = value ?? null;
      if (String(current ?? '') === String(next ?? '')) continue;
      patch[field] = next;
      changes[field] = { was: current, became: next };
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ case: before, changed: 0 });
    }

    patch.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from('legal_enforcement_cases')
      .update(patch)
      .eq('id', caseId)
      .select('*')
      .single();
    if (error) throw error;

    await writeLegalAudit({
      action: 'legal_enforcement_case_edited',
      entity: 'legal_enforcement_case',
      entityId: caseId,
      performedBy: String(session.user.id),
      details: { changes },
    });

    return NextResponse.json({ case: updated, changed: Object.keys(changes).length });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось сохранить правку' }, { status: 500 });
  }
}
