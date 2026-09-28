// Реестр дел: список со сводкой и создание дела.
// Дело заводит только юрист — менеджеры сюда не пишут (решение Андрея 28.09.2026).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { writeLegalAudit } from '@/lib/legal-audit';
import { listMatters, nextMatterNo } from '@/lib/legal-matters/repo';
import { buildAttentionList, buildSummary } from '@/lib/legal-matters/attention';
import { matterCreateSchema } from '@/lib/legal-matters/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const matters = await listMatters({
      stage: url.searchParams.get('stage'),
      status: url.searchParams.get('status'),
      responsible: url.searchParams.get('responsible'),
      side: url.searchParams.get('side'),
      search: url.searchParams.get('search'),
      openOnly: url.searchParams.get('open') === '1',
    });

    return NextResponse.json({
      matters,
      summary: buildSummary(matters),
      attention: buildAttentionList(matters).slice(0, 20),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось получить реестр дел' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = matterCreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Проверьте поля' }, { status: 400 });
    }

    const matterNo = await nextMatterNo();

    const { data: created, error } = await supabase
      .from('legal_matters')
      .insert({
        ...parsed.data,
        matter_no: matterNo,
        stage: 'claim',
        status: 'new',
        created_by: String(session.user.id),
        responsible_user_id: parsed.data.responsible_user_id || String(session.user.id),
      })
      .select('*')
      .single();

    if (error) throw error;

    await writeLegalAudit({
      action: 'legal_matter_created',
      entity: 'legal_matter',
      entityId: created.id,
      performedBy: String(session.user.id),
      details: { matter_no: matterNo, counterparty: parsed.data.counterparty_name },
    });

    return NextResponse.json({ matter: created });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось создать дело' }, { status: 500 });
  }
}
