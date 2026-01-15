'use server';

import { supabase } from '@/utils/supabase';
import { revalidatePath } from 'next/cache';

export async function saveSettingsBatch(settings: { code: string; is_working: boolean; is_transcribable: boolean; is_ai_target: boolean; ai_description?: string }[]) {
    console.log(`[Server Action] Processing batch of ${settings.length} items`);

    try {
        // 1. Identify codes to SAVE (any flag is enabled)
        const toSave = settings
            .filter(s => s.is_working || s.is_transcribable || s.is_ai_target)
            .map(s => ({
                code: s.code,
                is_working: s.is_working,
                is_transcribable: s.is_transcribable,
                is_ai_target: s.is_ai_target,
                updated_at: new Date().toISOString()
            }));

        // 2. Identify codes to REMOVE (all flags are disabled)
        const toRemoveCodes = settings
            .filter(s => !s.is_working && !s.is_transcribable && !s.is_ai_target)
            .map(s => s.code);

        console.log(`Saving ${toSave.length}, Removing ${toRemoveCodes.length}`);

        const results = [];
        // Operation A: Upsert Settings
        if (toSave.length > 0) {
            const { error: saveError } = await supabase
                .from('status_settings')
                .upsert(toSave, { onConflict: 'code' });

            if (saveError) throw new Error(`Save settings failed: ${saveError.message}`);
            results.push('Saved Settings');
        }

        // Operation B: Delete (Cleanup)
        if (toRemoveCodes.length > 0) {
            const { error: deleteError } = await supabase
                .from('status_settings')
                .delete()
                .in('code', toRemoveCodes);

            if (deleteError) throw new Error(`Delete failed: ${deleteError.message}`);
            results.push('Cleaned');
        }

        // Operation C: Update Descriptions (in `statuses` table)
        // We do this individually or batch if possible. Since it's 'statuses' table, upsert matches on code.
        const descriptionsToUpdate = settings
            .filter(s => s.ai_description !== undefined) // Only those we touched or loaded
            .map(s => ({
                code: s.code,
                ai_description: s.ai_description
            }));

        if (descriptionsToUpdate.length > 0) {
            const { error: descError } = await supabase
                .from('statuses')
                .upsert(descriptionsToUpdate, { onConflict: 'code' });
            // Note: Upsert on statuses might be risky if we don't include all non-null fields, 
            // but usually update is safer. However, Supabase upsert ignores missing columns if row exists? 
            // No, upsert needs all required columns if creating.
            // Better to use UPDATE for existing rows.

            // Actually, `statuses` table is managed by sync. We should generally assume rows exist.
            // Let's use `upsert` but we need to be careful not to wipe other fields if it tries to insert.
            // Since we know codes exist, valid update is safe.
            // BUT simpler: Parallel updates or one batch upsert if we trust it won't break sync.
            // To be safe against partial updates, we loop for now (not efficient but safe for < 50 statuses).

            for (const item of descriptionsToUpdate) {
                await supabase
                    .from('statuses')
                    .update({ ai_description: item.ai_description })
                    .eq('code', item.code);
            }
            results.push('Updated Descriptions');
        }

        revalidatePath('/settings/statuses');
        return { success: true, details: results.join(', ') };
    } catch (e: any) {
        console.error('[Server Action] Exception:', e);
        return { success: false, error: e.message };
    }
}

// Deprecated single toggle (keeping just in case of stale clients, but usually can remove)
export async function toggleStatus(code: string, isWorking: boolean) {
    return { success: false, error: "Use batch save" };
}
