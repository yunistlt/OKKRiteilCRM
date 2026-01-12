'use server';

import { supabase } from '@/utils/supabase';
import { revalidatePath } from 'next/cache';

export async function saveSettingsBatch(settings: { code: string; is_working: boolean; is_transcribable: boolean; is_ai_target: boolean }[]) {
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
        // Operation A: Upsert
        if (toSave.length > 0) {
            const { error: saveError } = await supabase
                .from('status_settings')
                .upsert(toSave, { onConflict: 'code' });

            if (saveError) throw new Error(`Save failed: ${saveError.message}`);
            results.push('Saved');
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
