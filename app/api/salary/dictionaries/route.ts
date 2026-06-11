import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// GET /api/salary/dictionaries — справочники RetailCRM для базовых параметров ЗП:
// статусы, способы заказа, категории товара — по именам (закон «всё из СРМ»).
export async function GET() {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }

        // справочник категорий, на который ссылается поле заказа typ_castomer
        const { data: fieldRow } = await supabase
            .from('retailcrm_custom_fields')
            .select('dictionary')
            .eq('entity', 'order')
            .eq('code', 'typ_castomer')
            .maybeSingle();
        const catDict = (fieldRow?.dictionary as string) || 'kategoriya_klienta';

        const [statusesRes, methodsRes, catsRes] = await Promise.all([
            supabase.from('retailcrm_dictionaries').select('item_code,item_name').eq('entity_type', 'status').order('item_name'),
            supabase.from('retailcrm_dictionaries').select('item_code,item_name').eq('entity_type', 'orderMethod').order('item_name'),
            supabase.from('retailcrm_dictionaries').select('item_code,item_name').eq('entity_type', 'customField').eq('dictionary_code', catDict).order('item_name'),
        ]);

        const map = (rows: any[] | null) => (rows ?? []).map((r) => ({ code: r.item_code, name: r.item_name }));
        return NextResponse.json({
            statuses: map(statusesRes.data),
            orderMethods: map(methodsRes.data),
            categories: map(catsRes.data),
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
