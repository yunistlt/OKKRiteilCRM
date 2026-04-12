import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL;
const RETAILCRM_KEY = process.env.RETAILCRM_API_KEY;

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
    if (!RETAILCRM_URL || !RETAILCRM_KEY) {
        return NextResponse.json({ error: 'RetailCRM config missing' }, { status: 500 });
    }

    try {
        const baseUrl = RETAILCRM_URL.replace(/\/+$/, '');
        const url = `${baseUrl}/api/v5/custom-fields?apiKey=${RETAILCRM_KEY}&type=order`;
        console.log('[Dict Sync] Fetching custom fields:', url);

        const res = await fetch(url);
        if (!res.ok) throw new Error(`RetailCRM API Error: ${res.status}`);

        const data = await res.json();
        if (!data.success) throw new Error(`RetailCRM Success False: ${JSON.stringify(data)}`);

        const customFields = data.customFields || [];
        const rowsToUpsert: any[] = [];

        // We are interested in 'prichiny_otmeny' and maybe others like 'kategoriya_klienta'
        const targetCodes = ['prichiny_otmeny', 'kategoriya_klienta', 'type_customer', 'sfera_deiatelnosti'];

        for (const field of customFields) {
            if (targetCodes.includes(field.code) && field.dictionaryElements) {
                console.log(`[Dict Sync] Found dictionary for ${field.code} with ${field.dictionaryElements.length} elements`);
                
                for (const element of field.dictionaryElements) {
                    rowsToUpsert.push({
                        entity_type: 'customField',
                        dictionary_code: field.code,
                        item_code: element.code,
                        item_name: element.name,
                        updated_at: new Date().toISOString()
                    });
                }
            }
        }

        if (rowsToUpsert.length > 0) {
            const { error } = await supabase
                .from('retailcrm_dictionaries')
                .upsert(rowsToUpsert, { 
                    onConflict: 'entity_type,dictionary_code,item_code' 
                });

            if (error) {
                console.error('[Dict Sync] Upsert Error:', error);
                throw error;
            }
        }

        return NextResponse.json({
            success: true,
            synced_count: rowsToUpsert.length,
            fields_processed: targetCodes.filter(code => customFields.some((f: any) => f.code === code))
        });

    } catch (error: any) {
        console.error('[Dict Sync] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
