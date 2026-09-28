// Справочники раздела: стадии, статусы, категории, виды событий, подписи денежных полей.
// ЗАКОН проекта: русские названия берём из БД, а не хардкодим в интерфейсе.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [{ data: items, error }, { data: entities }] = await Promise.all([
      supabase
        .from('legal_matter_dictionaries')
        .select('kind, code, name, description, color, sort_order, active')
        .eq('active', true)
        .order('kind', { ascending: true })
        .order('sort_order', { ascending: true }),
      supabase.from('legal_entities').select('inn, short_name, kind, active').eq('active', true).order('sort_order'),
    ]);

    if (error) throw error;

    const grouped: Record<string, any[]> = {};
    for (const item of items || []) {
      (grouped[item.kind] ||= []).push(item);
    }

    return NextResponse.json({ dictionaries: grouped, entities: entities || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Не удалось получить справочники' }, { status: 500 });
  }
}
