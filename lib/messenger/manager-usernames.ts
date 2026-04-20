import { supabase } from '@/utils/supabase';

export type ManagerAccountDirectoryEntry = {
    username: string | null;
    avatar_url: string | null;
};

export async function loadManagerAccountDirectory(managerIds: number[]) {
    const normalizedIds = Array.from(new Set(managerIds.filter((value) => Number.isInteger(value) && value > 0)));

    if (normalizedIds.length === 0) {
        return new Map<number, ManagerAccountDirectoryEntry>();
    }

    const { data, error } = await supabase
        .from('users')
        .select('username, avatar_url, retail_crm_manager_id')
        .in('retail_crm_manager_id', normalizedIds);

    if (error) {
        throw error;
    }

    const directory = new Map<number, ManagerAccountDirectoryEntry>();
    for (const row of data || []) {
        if (typeof row.retail_crm_manager_id === 'number') {
            directory.set(row.retail_crm_manager_id, {
                username: row.username || null,
                avatar_url: row.avatar_url || null,
            });
        }
    }

    return directory;
}

export async function loadManagerUsernames(managerIds: number[]) {
    const directory = await loadManagerAccountDirectory(managerIds);
    const usernamesByManagerId = new Map<number, string | null>();
    directory.forEach((account, managerId) => {
        usernamesByManagerId.set(managerId, account.username);
    });

    return usernamesByManagerId;
}