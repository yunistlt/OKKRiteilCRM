// Связь дела со стадиями, живущими в своих таблицах: суды, исполнительные
// производства, заказы, платежи. Схему тех таблиц не трогаем — связь только здесь.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { writeLegalAudit } from '@/lib/legal-audit';
import { matterLinkSchema } from '@/lib/legal-matters/types';

export const dynamic = 'force-dynamic';

/**
 * Что можно подключить к делу: судебные дела и исполнительные производства,
 * которые ведутся в своих разделах. Отдаём кандидатов для выбора человеком —
 * автоматически ничего не связываем: ошибочная связь искажает суммы по делу.
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const term = (new URL(request.url).searchParams.get('q') || '').trim();

    let courtQuery = supabase
      .from('court_cases')
      .select('id, case_number, court_name, plaintiff, defendant, amount_kopecks, status')
      .order('registered_on', { ascending: false })
      .limit(50);

    let enforcementQuery = supabase
      .from('legal_enforcement_cases')
      .select('id, case_number, debtor_name, claimant_name, debt_amount_kopecks, status')
      .order('created_at', { ascending: false })
      .limit(50);

    if (term) {
      courtQuery = courtQuery.or(`case_number.ilike.%${term}%,plaintiff.ilike.%${term}%,defendant.ilike.%${term}%`);
      enforcementQuery = enforcementQuery.or(`case_number.ilike.%${term}%,debtor_name.ilike.%${term}%,claimant_name.ilike.%${term}%`);
    }

    const [{ data: courtCases }, { data: enforcementCases }] = await Promise.all([courtQuery, enforcementQuery]);

    return NextResponse.json({
      court_cases: courtCases || [],
      enforcement_cases: enforcementCases || [],
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось получить кандидатов' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = matterLinkSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Проверьте поля' }, { status: 400 });
    }

    const { data: link, error } = await supabase
      .from('legal_matter_links')
      .insert({ ...parsed.data, link_state: 'confirmed', created_by: String(session.user.id) })
      .select('*')
      .single();

    if (error) throw error;

    await writeLegalAudit({
      action: 'legal_matter_link_added',
      entity: 'legal_matter',
      entityId: parsed.data.matter_id,
      performedBy: String(session.user.id),
      details: { target_kind: parsed.data.target_kind, target_id: parsed.data.target_id },
    });

    return NextResponse.json({ link });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось связать со стадией' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const id = Number(new URL(request.url).searchParams.get('id'));
    if (!id) return NextResponse.json({ error: 'Не указана связь' }, { status: 400 });

    const { error } = await supabase.from('legal_matter_links').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось убрать связь' }, { status: 500 });
  }
}
