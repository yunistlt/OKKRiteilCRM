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

        // Справочник причин отмены — для правил «Смета», «Не наша продукция», дублей.
        // Код поля берём из конфига ЗП (cancel_reason_field), сам справочник — из
        // карточки поля в CRM, чтобы не зашивать ни код поля, ни имя справочника.
        const { data: reasonCfg } = await supabase
            .from('salary_config')
            .select('value')
            .eq('key', 'cancel_reason_field')
            .order('effective_from', { ascending: false })
            .limit(1);
        const reasonFieldCode = ((reasonCfg?.[0]?.value as any)?.code as string) || 'prichiny_otmeny';
        const { data: reasonFieldRow } = await supabase
            .from('retailcrm_custom_fields')
            .select('dictionary')
            .eq('entity', 'order')
            .eq('code', reasonFieldCode)
            .maybeSingle();
        const reasonDict = (reasonFieldRow?.dictionary as string) || 'prichiny_otmeny_zakazov';

        const [statusesRes, methodsRes, catsRes, reasonsRes] = await Promise.all([
            supabase.from('retailcrm_dictionaries').select('item_code,item_name').eq('entity_type', 'status').order('item_name'),
            supabase.from('retailcrm_dictionaries').select('item_code,item_name').eq('entity_type', 'orderMethod').order('item_name'),
            supabase.from('retailcrm_dictionaries').select('item_code,item_name').eq('entity_type', 'customField').eq('dictionary_code', catDict).order('item_name'),
            supabase.from('retailcrm_dictionaries').select('item_code,item_name').eq('entity_type', 'customField').eq('dictionary_code', reasonDict).order('item_name'),
        ]);

        const map = (rows: any[] | null) => (rows ?? []).map((r) => ({ code: r.item_code, name: r.item_name }));
        return NextResponse.json({
            statuses: map(statusesRes.data),
            orderMethods: map(methodsRes.data),
            categories: map(catsRes.data),
            cancelReasons: map(reasonsRes.data),
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
