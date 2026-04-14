'use server';

import { supabase } from '@/utils/supabase';
import { revalidatePath } from 'next/cache';

function sanitizeLoginCandidate(value: string | null | undefined) {
    return (value || '')
        .trim()
        .toLowerCase()
        .replace(/^@+/, '')
        .replace(/[^a-z0-9._-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

async function ensureOkkAccountsForManagers(controlledIds: number[]) {
    if (controlledIds.length === 0) {
        return { created: [] as string[], skipped: [] as string[] };
    }

    const { data: managers, error: managersError } = await supabase
        .from('managers')
        .select('id, first_name, last_name, email, raw_data')
        .in('id', controlledIds);

    if (managersError) {
        throw managersError;
    }

    const { data: existingUsers, error: usersError } = await supabase
        .from('users')
        .select('id, username, retail_crm_manager_id')
        .in('retail_crm_manager_id', controlledIds);

    if (usersError) {
        throw usersError;
    }

    const existingByManagerId = new Map<number, { id: string; username: string }>();
    const occupiedLogins = new Set<string>();

    for (const user of existingUsers || []) {
        if (user.username) occupiedLogins.add(String(user.username).toLowerCase());
        if (typeof user.retail_crm_manager_id === 'number') {
            existingByManagerId.set(user.retail_crm_manager_id, { id: user.id, username: user.username });
        }
    }

    const inserts: Array<{
        username: string;
        password_hash: string;
        role: 'manager';
        retail_crm_manager_id: number;
        first_name: string | null;
        last_name: string | null;
    }> = [];
    const created: string[] = [];
    const skipped: string[] = [];

    for (const manager of managers || []) {
        if (existingByManagerId.has(manager.id)) {
            skipped.push(existingByManagerId.get(manager.id)?.username || `manager_${manager.id}`);
            continue;
        }

        const telegramUsername = sanitizeLoginCandidate(manager.raw_data?.telegram_username);
        const emailLocalPart = sanitizeLoginCandidate(typeof manager.email === 'string' ? manager.email.split('@')[0] : '');
        const nameBased = sanitizeLoginCandidate([manager.first_name, manager.last_name].filter(Boolean).join('.'));

        let username = telegramUsername || emailLocalPart || nameBased || `manager_${manager.id}`;
        if (occupiedLogins.has(username)) {
            username = `${username}_${manager.id}`;
        }
        if (occupiedLogins.has(username)) {
            username = `manager_${manager.id}`;
        }

        occupiedLogins.add(username);
        created.push(username);
        inserts.push({
            username,
            password_hash: username,
            role: 'manager',
            retail_crm_manager_id: manager.id,
            first_name: manager.first_name || null,
            last_name: manager.last_name || null,
        });
    }

    if (inserts.length > 0) {
        const { error: insertError } = await supabase
            .from('users')
            .insert(inserts);

        if (insertError) {
            throw insertError;
        }
    }

    return { created, skipped };
}

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

        const provisioning = await ensureOkkAccountsForManagers(controlledIds);

        revalidatePath('/settings/managers');
        revalidatePath('/analytics/violations');
        revalidatePath('/efficiency');
        revalidatePath('/settings/profile');

        return {
            success: true,
            createdAccounts: provisioning.created,
            skippedAccounts: provisioning.skipped,
        };
    } catch (e: any) {
        console.error('[ManagerSettings] General Save Exception:', e);
        return { success: false, error: e.message };
    }
}
