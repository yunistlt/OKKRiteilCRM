import type { AppSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

type ManagerIdentity = {
    id: number;
    first_name: string | null;
    last_name: string | null;
    active?: boolean | null;
};

type ManagerLinkedIdentity = {
    retail_crm_manager_id?: number | null;
    first_name?: string | null;
    last_name?: string | null;
};

export async function loadManagerIdentity(retailCrmManagerId: number | null | undefined): Promise<ManagerIdentity | null> {
    if (!retailCrmManagerId) {
        return null;
    }

    const { data, error } = await supabase
        .from('managers')
        .select('id, first_name, last_name, active')
        .eq('id', retailCrmManagerId)
        .maybeSingle();

    if (error || !data) {
        return null;
    }

    return data;
}

export async function enrichManagerLinkedIdentity<T extends ManagerLinkedIdentity>(entity: T | null): Promise<T | null> {
    if (!entity?.retail_crm_manager_id) {
        return entity;
    }

    const manager = await loadManagerIdentity(entity.retail_crm_manager_id);
    if (!manager) {
        return entity;
    }

    return {
        ...entity,
        first_name: manager.first_name || entity.first_name || null,
        last_name: manager.last_name || entity.last_name || null,
    };
}

export async function enrichSessionWithManagerIdentity(session: AppSession | null): Promise<AppSession | null> {
    if (!session?.user) {
        return session;
    }

    const enrichedUser = await enrichManagerLinkedIdentity(session.user);
    if (!enrichedUser) {
        return session;
    }

    return {
        ...session,
        user: {
            ...session.user,
            first_name: enrichedUser.first_name || null,
            last_name: enrichedUser.last_name || null,
        },
    };
}

export function isManagerBoundAccount(entity: { role?: string | null; retail_crm_manager_id?: number | null } | null | undefined) {
    return entity?.role === 'manager' && !!entity?.retail_crm_manager_id;
}