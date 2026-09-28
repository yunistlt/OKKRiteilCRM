// Решение человека по предложенному полю: подтвердить (можно с правкой) или отклонить.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { enforcementFactDecisionSchema } from '@/lib/legal-enforcement/types';
import { decideFact, recalcCaseStatus } from '@/lib/legal-enforcement/facts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = enforcementFactDecisionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Проверьте запрос' }, { status: 400 });
    }

    const result = await decideFact({
      factId: parsed.data.fact_id,
      decision: parsed.data.decision,
      correctedValue: parsed.data.corrected_value,
      userId: String(session.user.id),
    });

    const status = await recalcCaseStatus(result.case_id);

    await supabase.from('legal_audit_log').insert({
      action: `legal_enforcement_fact_${parsed.data.decision}`,
      entity: 'legal_enforcement_field_fact',
      entity_id: parsed.data.fact_id,
      performed_by: session.user.id,
      details: { field: result.field, applied: result.applied, corrected: parsed.data.corrected_value || null },
    });

    return NextResponse.json({ ok: true, field: result.field, applied: result.applied, case_status: status });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось сохранить решение' }, { status: 500 });
  }
}
