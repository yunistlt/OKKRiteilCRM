'use server';

import { supabase } from '@/utils/supabase';
import { revalidatePath } from 'next/cache';

export async function saveManagerSettings(controlledIds: number[]) {
    try {
        // 1. Delete all existing settings to perform a clean sync
        const { error: deleteError } = await supabase
            .from('manager_settings')
            .delete()
            .neq('id', 0); // Hack to delete all records

        if (deleteError) {
            console.error('[ManagerSettings] Delete Error:', deleteError);
            // Check for missing relation (table not found) or schema cache issues
            const isMissingTable =
                deleteError.code === '42P01' ||
                deleteError.code === 'PGRST116' ||
                deleteError.message.includes('relation "manager_settings" does not exist') ||
                deleteError.message.includes('schema cache');

            if (isMissingTable) {
                return { success: false, errorType: 'TABLE_MISSING' };
            }
            throw deleteError;
        }

        // 2. Insert new controlled IDs
        if (controlledIds.length > 0) {
            const { error: insertError } = await supabase
                .from('manager_settings')
                .insert(controlledIds.map(id => ({ id, is_controlled: true })));

            if (insertError) {
                console.error('[ManagerSettings] Insert Error:', insertError);
                throw insertError;
            }
        }

        revalidatePath('/settings/managers');
        revalidatePath('/analytics/violations');
        revalidatePath('/efficiency');

        return { success: true };
    } catch (e: any) {
        console.error('[ManagerSettings] General Save Exception:', e);
        return { success: false, error: e.message };
    }
}
