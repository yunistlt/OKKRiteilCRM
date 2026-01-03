import { supabase } from '../utils/supabase';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const RETAILCRM_URL = process.env.RETAILCRM_URL;
const RETAILCRM_API_KEY = process.env.RETAILCRM_API_KEY;

async function syncMeta() {
    console.log('🔄 Starting RetailCRM Metadata Sync...\n');

    if (!RETAILCRM_URL || !RETAILCRM_API_KEY) {
        console.error('❌ RetailCRM config missing');
        return;
    }

    const dictsToSync: any[] = [];

    // 1. Sync Order Methods
    console.log('📦 Fetching Order Methods...');
    const omRes = await fetch(`${RETAILCRM_URL}/api/v5/reference/order-methods?apiKey=${RETAILCRM_API_KEY}`);
    const omData = await omRes.json();
    if (omData.success && omData.orderMethods) {
        Object.values(omData.orderMethods).forEach((om: any) => {
            if (om.active) {
                dictsToSync.push({
                    entity_type: 'orderMethod',
                    dictionary_code: null,
                    item_code: om.code,
                    item_name: om.name,
                    updated_at: new Date().toISOString()
                });
            }
        });
        console.log(`✅ Collected ${Object.keys(omData.orderMethods).length} order methods.`);
    }

    // 2. Sync Custom Field Dictionaries
    console.log('📋 Fetching Custom Field Dictionaries...');
    const cdRes = await fetch(`${RETAILCRM_URL}/api/v5/custom-fields/dictionaries?apiKey=${RETAILCRM_API_KEY}`);
    const cdData = await cdRes.json();
    if (cdData.success && cdData.customDictionaries) {
        for (const dict of cdData.customDictionaries) {
            console.log(`   - Syncing dictionary: ${dict.name} (${dict.code})`);
            // The list endpoint might already have elements, or we might need to fetch individually
            // But from my probe show, the list endpoint actually returns elements too (up to some point)
            const elements = dict.elements || [];
            elements.forEach((el: any) => {
                dictsToSync.push({
                    entity_type: 'customField',
                    dictionary_code: dict.code,
                    item_code: el.code,
                    item_name: el.name,
                    updated_at: new Date().toISOString()
                });
            });
        }
    }

    // 3. Sync Statuses (Optional, if we want them in this table too, but we have a statuses table)
    // For consistency with the UI request for "civilian labels", let's include them.
    console.log('🚦 Fetching Statuses...');
    const stRes = await fetch(`${RETAILCRM_URL}/api/v5/reference/statuses?apiKey=${RETAILCRM_API_KEY}`);
    const stData = await stRes.json();
    if (stData.success && stData.statuses) {
        Object.values(stData.statuses).forEach((s: any) => {
            dictsToSync.push({
                entity_type: 'status',
                dictionary_code: null,
                item_code: s.code,
                item_name: s.name,
                updated_at: new Date().toISOString()
            });
        });
        console.log(`✅ Collected ${Object.keys(stData.statuses).length} statuses.`);
    }

    // 4. Batch Upsert to Supabase
    if (dictsToSync.length > 0) {
        console.log(`\n📤 Upserting ${dictsToSync.length} entries to retailcrm_dictionaries...`);
        const { error } = await supabase
            .from('retailcrm_dictionaries')
            .upsert(dictsToSync, { onConflict: 'entity_type,dictionary_code,item_code' });

        if (error) {
            console.error('❌ Upsert failed:', error.message);
            if (error.code === 'PGRST116' || error.message.includes('not found')) {
                console.log('\n⚠️  Table "retailcrm_dictionaries" does not exist yet.');
                console.log('Please run the migration SQL from "migrations/20260102_retailcrm_dictionaries.sql" in Supabase Dashboard.');
            }
        } else {
            console.log('✅ Sync completed successfully!');
        }
    } else {
        console.log('⚠️ No data to sync.');
    }
}

syncMeta();
