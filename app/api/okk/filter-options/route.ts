import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { CUSTOM_FIELD_CODES } from '@/lib/orders-filter';

export const dynamic = 'force-dynamic';

/**
 * Значения для выпадающих списков панели фильтров.
 * Названия берём из справочника RetailCRM — в интерфейсе кодов быть не должно.
 */
export async function GET() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const [categories, sferas] = await Promise.all([
        supabase
            .from('retailcrm_dictionaries')
            .select('item_code, item_name')
            .eq('dictionary_code', CUSTOM_FIELD_CODES.category)
            .eq('active', true)
            .order('item_name'),
        supabase
            .from('retailcrm_dictionaries')
            .select('item_code, item_name')
            .eq('dictionary_code', CUSTOM_FIELD_CODES.sfera)
            .eq('active', true)
            .order('item_name'),
    ]);

    const map = (rows: any[] | null) =>
        (rows ?? []).map((r) => ({ value: r.item_code, label: r.item_name }));

    return NextResponse.json({
        ok: true,
        categories: map(categories.data),
        sferas: map(sferas.data),
    });
}
