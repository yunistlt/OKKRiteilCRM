import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// GET /api/salary/categories — категории товара для блоков ЗП «по категориям».
// Категория заказа лежит в customFields.typ_castomer; её значения описаны
// справочником RetailCRM (по умолчанию kategoriya_klienta), синкается
// /api/sync/dictionaries. dictionary_code определяем по связи поля → справочник
// из retailcrm_custom_fields (order.typ_castomer → dictionary), с фолбэком.
export async function GET() {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }

        // Справочник, на который ссылается поле заказа typ_castomer
        const { data: fieldRow } = await supabase
            .from('retailcrm_custom_fields')
            .select('dictionary')
            .eq('entity', 'order')
            .eq('code', 'typ_castomer')
            .maybeSingle();
        const dictCode = (fieldRow?.dictionary as string) || 'kategoriya_klienta';

        const { data, error } = await supabase
            .from('retailcrm_dictionaries')
            .select('item_code,item_name')
            .eq('entity_type', 'customField')
            .eq('dictionary_code', dictCode)
            .order('item_name', { ascending: true });
        if (error) throw error;

        const categories = (data ?? []).map((r: any) => ({ code: r.item_code, name: r.item_name }));
        return NextResponse.json({ categories, dictionaryCode: dictCode });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
