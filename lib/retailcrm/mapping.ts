import { supabase } from '@/utils/supabase';
// ОТВЕТСТВЕННЫЙ: СЕМЁН (Архивариус) — Маппинг и нормализация данных из RetailCRM.

// ЗАКОН: никаких захардкоженных названий. Все человекочитаемые имена справочников
// (способы заказа, категории товара/клиента, статусы и т.п.) берём ТОЛЬКО из
// синканутого каталога RetailCRM — retailcrm_dictionaries (см. resolveRetailCRMLabel,
// DB-first). Полный синк: lib/retailcrm/dictionaries-sync.ts.

export async function resolveRetailCRMLabel(
    field: 'orderMethod' | 'productCategory' | 'clientCategory' | 'status' | 'top3Price' | 'top3Timing' | 'top3Specs',
    code: string | null
): Promise<string> {
    if (!code) return 'Не указано';

    // 1. Try DB first (most accurate for dynamic labels)
    try {
        let entityType = '';
        let dictCode: string | null = null;

        if (field === 'orderMethod') entityType = 'orderMethod';
        else if (field === 'status') entityType = 'status';
        else if (field === 'productCategory') {
            entityType = 'customField';
            dictCode = 'kategoriya_klienta';
        } else if (field === 'clientCategory') {
            entityType = 'customField';
            dictCode = 'sfera_deiatelnosti';
        } else if (field.startsWith('top3')) {
            entityType = 'customField';
            dictCode = 'da_net';
        }

        const query = supabase
            .from('retailcrm_dictionaries')
            .select('item_name')
            .eq('entity_type', entityType)
            .eq('item_code', code);

        if (dictCode) {
            query.eq('dictionary_code', dictCode);
        }

        const { data } = await query.maybeSingle();
        if (data?.item_name) return data.item_name;

        // Dual-dictionary check for clientCategory
        if (field === 'clientCategory') {
            const { data: data2 } = await supabase
                .from('retailcrm_dictionaries')
                .select('item_name')
                .eq('entity_type', 'customField')
                .eq('dictionary_code', 'type_customer')
                .eq('item_code', code)
                .maybeSingle();
            if (data2?.item_name) return data2.item_name;
        }
    } catch (e) {
        // Probably table missing, proceed to static fallback
    }

    // 2. Последний резерв: гуманизация кода (если кода нет в синканутых справочниках CRM —
    //    напр. устаревший/удалённый код). Имена не выдумываем.
    return code
        .replace(/-/g, ' ')
        .replace(/_/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
