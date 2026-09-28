// Перевод карточки в «Учтено в ФД-отчёте» / «Закрыто» — это решение человека, не бота.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { enforcementCaseStatusSchema } from '@/lib/legal-enforcement/types';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = enforcementCaseStatusSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Проверьте запрос' }, { status: 400 });
    }

    const { case_id, status, closed_reason } = parsed.data;

    const { count: pending } = await supabase
      .from('legal_enforcement_field_facts')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', case_id)
      .eq('state', 'suggested');

    if ((status === 'confirmed' || status === 'in_fd_report') && (pending || 0) > 0) {
      return NextResponse.json(
        { error: `Осталось непроверенных полей: ${pending}. Сначала подтвердите или отклоните их.` },
        { status: 400 },
      );
    }

    const patch: Record<string, any> = { status, updated_at: new Date().toISOString() };
    if (status === 'closed') {
      patch.closed_on = new Date().toISOString().slice(0, 10);
      patch.closed_reason = closed_reason || null;
    }
    if (status === 'confirmed' || status === 'in_fd_report') {
      patch.confirmed_by = session.user.id;
      patch.confirmed_at = new Date().toISOString();
    }

    const { data: updated, error } = await supabase
      .from('legal_enforcement_cases')
      .update(patch)
      .eq('id', case_id)
      .select('*')
      .single();
    if (error) throw error;

    await supabase.from('legal_audit_log').insert({
      action: 'legal_enforcement_status_changed',
      entity: 'legal_enforcement_case',
      entity_id: case_id,
      performed_by: session.user.id,
      details: { status, closed_reason: closed_reason || null },
    });

    return NextResponse.json({ case: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось сменить статус' }, { status: 500 });
  }
}
