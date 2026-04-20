import { supabase } from '@/utils/supabase';

export async function loadManagerUsernames(managerIds: number[]) {
    const normalizedIds = Array.from(new Set(managerIds.filter((value) => Number.isInteger(value) && value > 0)));

    if (normalizedIds.length === 0) {
        return new Map<number, string | null>();
    }

    const { data, error } = await supabase
        .from('users')
        .select('username, retail_crm_manager_id')
        .in('retail_crm_manager_id', normalizedIds);

    if (error) {
        throw error;
    }

    const usernamesByManagerId = new Map<number, string | null>();
    for (const row of data || []) {
        if (typeof row.retail_crm_manager_id === 'number') {
            usernamesByManagerId.set(row.retail_crm_manager_id, row.username || null);
        }
    }

    return usernamesByManagerId;
}