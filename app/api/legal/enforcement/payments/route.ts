// Платежи по производству: подбор кандидатов (POST) и решение человека (PATCH).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { writeLegalAudit } from '@/lib/legal-audit';
import { enforcementParseSchema, enforcementPaymentLinkSchema } from '@/lib/legal-enforcement/types';
import {
  decidePaymentLink,
  outgoingPaymentsAvailable,
  persistSuggestions,
  suggestPaymentsForCase,
} from '@/lib/legal-enforcement/payment-match';
import { recalcCaseStatus } from '@/lib/legal-enforcement/facts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = enforcementParseSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'Нужен case_id' }, { status: 400 });

    const suggestions = await suggestPaymentsForCase(parsed.data.case_id);
    const stored = await persistSuggestions(parsed.data.case_id, suggestions);

    return NextResponse.json({
      suggestions,
      stored,
      // Честно про данные: списаний в базе платежей пока нет вовсе.
      outgoing_payments_available: await outgoingPaymentsAvailable(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось подобрать платежи' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = enforcementPaymentLinkSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Проверьте запрос' }, { status: 400 });
    }

    await decidePaymentLink({
      caseId: parsed.data.case_id,
      paymentId: parsed.data.payment_id,
      decision: parsed.data.decision,
      userId: String(session.user.id),
    });

    const status = await recalcCaseStatus(parsed.data.case_id);

    await writeLegalAudit({
      action: `legal_enforcement_payment_${parsed.data.decision}`,
      entity: 'legal_enforcement_case',
      entityId: parsed.data.case_id,
      performedBy: String(session.user.id),
      details: { payment_id: parsed.data.payment_id },
    });

    return NextResponse.json({ ok: true, case_status: status });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось сохранить связь' }, { status: 500 });
  }
}
