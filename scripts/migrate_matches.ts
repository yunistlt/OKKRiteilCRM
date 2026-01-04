
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabase } from '../utils/supabase';

async function migrate() {
    console.log('--- MIGRATING DEPRECATED MATCHES ---');

    // 1. Fetch old matches
    const { data: oldMatches, error: fetchError } = await supabase
        .from('matches_deprecated')
        .select('*');

    if (fetchError || !oldMatches) {
        console.error('Error fetching old matches:', fetchError);
        return;
    }

    console.log(`Found ${oldMatches.length} old matches to migrate.`);

    // 2. Map to new format
    const newRecords = oldMatches.map(m => ({
        telphin_call_id: m.call_id,
        retailcrm_order_id: m.order_id,
        match_type: 'manual', // Safest assumption: treat legacy as manual/verified or separate type? 'manual' implies high confidence.
        // If score is 1, maybe it was manual?
        confidence_score: m.score > 1 ? m.score / 100 : m.score, // Normalize if needed
        explanation: 'Migrated from Deprecated Table',
        matched_at: m.created_at,
        rule_id: 'legacy_migration'
    }));

    // 3. Insert with Ignore Duplicates
    // Chunking to avoid payload limit
    const chunkSize = 100;
    let migratedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < newRecords.length; i += chunkSize) {
        const chunk = newRecords.slice(i, i + chunkSize);

        const { error: insertError } = await supabase
            .from('call_order_matches')
            .upsert(chunk, {
                onConflict: 'telphin_call_id,retailcrm_order_id',
                ignoreDuplicates: true
            });

        if (insertError) {
            console.error('Error migrating chunk:', insertError);
            errorCount += chunk.length;
        } else {
            migratedCount += chunk.length;
        }
    }

    console.log(`Migration Complete: ${migratedCount} processed (duplicates ignored), ${errorCount} errors.`);

    // 4. Verify counts again
    const { count: finalCount } = await supabase.from('call_order_matches').select('*', { count: 'exact', head: true });
    console.log(`Final count in call_order_matches: ${finalCount}`);

    // Suggest dropping table manually or do it here?
    // Let's NOT drop distinct table in TS, let user confirm first.
    console.log('To drop the old table, run SQL: DROP TABLE matches_deprecated;');
}

migrate();
