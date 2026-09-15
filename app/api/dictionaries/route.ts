import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

/**
 * Каталог названий RetailCRM для интерфейса: значения справочников и системных
 * перечислений (`retailcrm_dictionaries`) + связь «поле → справочник»
 * (`retailcrm_custom_fields`). Клиент резолвит коды в русские имена
 * (components/useDictionaryNames.ts). Только активные значения.
 */
export async function GET() {
    const [dict, fields] = await Promise.all([
        supabase
            .from('retailcrm_dictionaries')
            .select('entity_type, dictionary_code, item_code, item_name')
            .eq('active', true),
        supabase.from('retailcrm_custom_fields').select('entity, code, name, dictionary').not('dictionary', 'is', null),
    ]);

    if (dict.error) {
        return NextResponse.json({ error: 'Не удалось загрузить справочники / Failed to load dictionaries' }, { status: 500 });
    }

    return NextResponse.json(
        {
            items: dict.data ?? [],
            fields: (fields.data ?? []).filter((f: { dictionary: string | null }) => f.dictionary),
        },
        { headers: { 'Cache-Control': 'private, max-age=300' } },
    );
}
