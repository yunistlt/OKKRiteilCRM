'use server';

import { supabase } from '@/utils/supabase';
import { revalidatePath } from 'next/cache';

export async function saveSettingsBatch(settings: { code: string; is_working: boolean; is_transcribable: boolean; is_ai_target: boolean; is_manager_load?: boolean; ai_description?: string; norm_days?: number | null }[]) {
    console.log(`[Server Action] Processing batch of ${settings.length} items`);

    try {
        // 1. Identify codes to SAVE (any flag is enabled)
        const toSave = settings
            .filter(s => s.is_working || s.is_transcribable || s.is_ai_target || s.is_manager_load)
            .map(s => ({
                code: s.code,
                is_working: s.is_working,
                is_transcribable: s.is_transcribable,
                is_ai_target: s.is_ai_target,
                is_manager_load: !!s.is_manager_load,
                updated_at: new Date().toISOString()
            }));

        // 2. Identify codes to REMOVE (all flags are disabled)
        const toRemoveCodes = settings
            .filter(s => !s.is_working && !s.is_transcribable && !s.is_ai_target && !s.is_manager_load)
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
            .filter(s => s.ai_description !== undefined || s.norm_days !== undefined) // Only those we touched or loaded
            .map(s => ({
                code: s.code,
                ai_description: s.ai_description,
                norm_days: s.norm_days ?? null
            }));

        if (descriptionsToUpdate.length > 0) {
            /**
             * Правим строки справочника статусов — `crm_statuses`, он один на
             * весь проект. Обновляем, а не upsert: статус заводится на экране
             * «Статусы и переходы», и создавать его отсюда нельзя.
             */
            for (const item of descriptionsToUpdate) {
                await supabase
                    .from('crm_statuses')
                    .update({ ai_description: item.ai_description, norm_days: item.norm_days })
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
