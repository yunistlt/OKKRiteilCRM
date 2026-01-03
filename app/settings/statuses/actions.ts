'use server';

import { supabase } from '@/utils/supabase';
import { revalidatePath } from 'next/cache';

export async function saveSettingsBatch(settings: { code: string; is_working: boolean }[]) {
    console.log(`[Server Action] Processing batch of ${settings.length} items`);

    try {
        // 1. Identify codes to SAVE (is_working = true)
        const toSave = settings
            .filter(s => s.is_working)
            .map(s => ({
                code: s.code,
                is_working: true,
                updated_at: new Date().toISOString()
            }));

        // 2. Identify codes to REMOVE (is_working = false)
        // We only need to remove them if they exist, but deleting by code is safe even if they don't.
        const toRemoveCodes = settings
            .filter(s => !s.is_working)
            .map(s => s.code);

        console.log(`Saving ${toSave.length}, Removing ${toRemoveCodes.length}`);

        const results = [];

        // Operation A: Upsert the "Working" ones
        if (toSave.length > 0) {
            const { error: saveError } = await supabase
                .from('status_settings')
                .upsert(toSave, { onConflict: 'code' });

            if (saveError) throw new Error(`Save failed: ${saveError.message}`);
            results.push('Saved');
        }

        // Operation B: Delete the "Not Working" ones (Cleanup)
        if (toRemoveCodes.length > 0) {
            const { error: deleteError } = await supabase
                .from('status_settings')
                .delete()
                .in('code', toRemoveCodes);

            if (deleteError) throw new Error(`Delete failed: ${deleteError.message}`);
            results.push('Cleaned');
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
