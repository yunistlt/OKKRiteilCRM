'use server';

import { login } from '@/lib/auth';
import { APP_ROLES, getDefaultPathForRole } from '@/lib/rbac';
import type { AppRole } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export type InvitationPublicInfo = {
    valid: boolean;
    role: AppRole | null;
    first_name: string | null;
    last_name: string | null;
    note: string | null;
};

type AcceptResult = {
    success: boolean;
    message?: string;
    redirectTo?: string;
};

function normalizeRole(rawRole: unknown): AppRole {
    return APP_ROLES.includes(rawRole as AppRole) ? (rawRole as AppRole) : 'manager';
}

async function loadActiveInvitation(token: string) {
    const normalized = token.trim();
    if (!normalized) return null;

    const { data, error } = await supabase
        .from('access_invitations')
        .select('id, role, retail_crm_manager_id, first_name, last_name, note, revoked, used_count')
        .eq('token', normalized)
        .maybeSingle();

    if (error || !data || data.revoked) return null;
    return data;
}

export async function getInvitationInfo(token: string): Promise<InvitationPublicInfo> {
    try {
        const invitation = await loadActiveInvitation(token);
        if (!invitation) {
            return { valid: false, role: null, first_name: null, last_name: null, note: null };
        }

        return {
            valid: true,
            role: normalizeRole(invitation.role),
            first_name: typeof invitation.first_name === 'string' ? invitation.first_name : null,
            last_name: typeof invitation.last_name === 'string' ? invitation.last_name : null,
            note: typeof invitation.note === 'string' ? invitation.note : null,
        };
    } catch {
        return { valid: false, role: null, first_name: null, last_name: null, note: null };
    }
}

async function isUsernameTaken(username: string): Promise<boolean> {
    const [usersResult, profilesResult] = await Promise.all([
        supabase.from('users').select('id').eq('username', username).maybeSingle(),
        supabase.from('profiles').select('id').eq('username', username).maybeSingle(),
    ]);

    return Boolean(usersResult.data) || Boolean(profilesResult.data);
}

export async function acceptInvitation(input: {
    token: string;
    username: string;
    password: string;
}): Promise<AcceptResult> {
    try {
        const username = String(input.username || '').trim();
        const password = String(input.password || '').trim();

        if (!username || !password) {
            return { success: false, message: 'Логин и пароль обязательны.' };
        }
        if (password.length < 6) {
            return { success: false, message: 'Пароль должен быть не короче 6 символов.' };
        }

        const invitation = await loadActiveInvitation(input.token);
        if (!invitation) {
            return { success: false, message: 'Ссылка-приглашение недействительна или отозвана.' };
        }

        if (await isUsernameTaken(username)) {
            return { success: false, message: 'Такой логин уже занят, выберите другой.' };
        }

        const role = normalizeRole(invitation.role);
        const retailCrmManagerId =
            role === 'manager' && typeof invitation.retail_crm_manager_id === 'number'
                ? invitation.retail_crm_manager_id
                : null;

        const { data: created, error: insertError } = await supabase
            .from('users')
            .insert({
                username,
                password_hash: password,
                first_name: typeof invitation.first_name === 'string' ? invitation.first_name : null,
                last_name: typeof invitation.last_name === 'string' ? invitation.last_name : null,
                role,
                retail_crm_manager_id: retailCrmManagerId,
            })
            .select('id, username, first_name, last_name, role, retail_crm_manager_id')
            .single();

        if (insertError) throw insertError;

        await supabase
            .from('access_invitations')
            .update({
                used_count: (typeof invitation.used_count === 'number' ? invitation.used_count : 0) + 1,
                last_used_at: new Date().toISOString(),
            })
            .eq('id', invitation.id);

        await login({
            id: String(created.id),
            username: created.username || username,
            role: created.role || role,
            retail_crm_manager_id: created.retail_crm_manager_id ?? retailCrmManagerId,
            first_name: created.first_name ?? null,
            last_name: created.last_name ?? null,
        });

        return { success: true, redirectTo: getDefaultPathForRole(role) };
    } catch (error: any) {
        const message = typeof error?.message === 'string' ? error.message : '';
        return { success: false, message: message || 'Не удалось создать аккаунт. Попробуйте позже.' };
    }
}
