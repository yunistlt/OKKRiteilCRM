'use server';

import { revalidatePath } from 'next/cache';
import { AppRole } from '@/lib/auth';
import { APP_ROLES, DEFAULT_ROUTE_RULES, normalizeAllowedRoles, RouteRule } from '@/lib/rbac';
import { clearRouteRulesCache } from '@/lib/rbac-server';
import { supabase } from '@/utils/supabase';
import { getSupabaseAdmin } from '@/utils/supabase-admin';

export type AccessAccount = {
    id: string;
    source: 'profile' | 'legacy';
    email: string | null;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    role: AppRole;
    retail_crm_manager_id: number | null;
    avatar_url?: string | null;
};

export type AccessManagerOption = {
    id: number;
    label: string;
    active: boolean;
};

function normalizeRole(rawRole: unknown): AppRole {
    return APP_ROLES.includes(rawRole as AppRole) ? (rawRole as AppRole) : 'manager';
}

function normalizeManagerId(rawManagerId: unknown): number | null {
    if (typeof rawManagerId === 'number' && Number.isFinite(rawManagerId)) return rawManagerId;
    if (typeof rawManagerId === 'string' && rawManagerId.trim()) {
        const parsed = Number(rawManagerId);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function normalizeAccount(record: any, source: 'profile' | 'legacy'): AccessAccount {
    return {
        id: String(record.id),
        source,
        email: typeof record.email === 'string' ? record.email : null,
        username: typeof record.username === 'string' ? record.username : null,
        first_name: typeof record.first_name === 'string' ? record.first_name : null,
        last_name: typeof record.last_name === 'string' ? record.last_name : null,
        role: normalizeRole(record.role),
        retail_crm_manager_id: normalizeManagerId(record.retail_crm_manager_id),
        avatar_url: typeof record.avatar_url === 'string' ? record.avatar_url : null,
    };
}

function isMissingTableError(error: any) {
    return Boolean(
        error?.code === '42P01' ||
        error?.message?.includes('relation') ||
        error?.message?.includes('access_route_rules')
    );
}

function sortAccounts(accounts: AccessAccount[]) {
    return accounts.sort((left, right) => {
        const roleComparison = APP_ROLES.indexOf(left.role) - APP_ROLES.indexOf(right.role);
        if (roleComparison !== 0) return roleComparison;

        const leftLabel = `${left.first_name || ''} ${left.last_name || ''}`.trim() || left.username || left.email || '';
        const rightLabel = `${right.first_name || ''} ${right.last_name || ''}`.trim() || right.username || right.email || '';
        return leftLabel.localeCompare(rightLabel, 'ru');
    });
}

export async function loadAccessControlData(): Promise<{
    accounts: AccessAccount[];
    managers: AccessManagerOption[];
    routeRules: RouteRule[];
    routeRulesTableReady: boolean;
}> {
    const [profilesResult, usersResult, managersResult, rulesResult] = await Promise.all([
        supabase.from('profiles').select('id, email, username, first_name, last_name, avatar_url, role, retail_crm_manager_id'),
        supabase.from('users').select('id, email, username, first_name, last_name, avatar_url, role, retail_crm_manager_id'),
        supabase.from('managers').select('id, first_name, last_name, active').order('last_name', { ascending: true, nullsFirst: false }),
        supabase.from('access_route_rules').select('prefix, label, description, category, allowed_roles'),
    ]);

    if (profilesResult.error && !isMissingTableError(profilesResult.error)) throw profilesResult.error;
    if (usersResult.error && !isMissingTableError(usersResult.error)) throw usersResult.error;
    if (managersResult.error) throw managersResult.error;
    if (rulesResult.error && !isMissingTableError(rulesResult.error)) throw rulesResult.error;

    const profiles: AccessAccount[] = (profilesResult.data || []).map((item: any) => normalizeAccount(item, 'profile'));
    const legacyAccounts = (usersResult.data || [])
        .filter((item: any) => !profiles.some((profile: AccessAccount) => profile.id === String(item.id)))
        .map((item: any) => normalizeAccount(item, 'legacy'));

    const routeRuleMap = new Map(
        ((rulesResult.data || []) as any[]).map((item) => [
            item.prefix,
            {
                prefix: item.prefix,
                label: item.label || item.prefix,
                description: item.description || '',
                category: item.category || 'Доступ',
                allowed: normalizeAllowedRoles(item.allowed_roles),
            } satisfies RouteRule,
        ])
    );

    return {
        accounts: sortAccounts([...profiles, ...legacyAccounts]),
        managers: (managersResult.data || []).map((manager: any) => ({
            id: manager.id,
            label: [manager.first_name, manager.last_name].filter(Boolean).join(' ').trim() || `Manager #${manager.id}`,
            active: Boolean(manager.active),
        })),
        routeRules: DEFAULT_ROUTE_RULES.map((rule) => routeRuleMap.get(rule.prefix) || rule),
        routeRulesTableReady: !Boolean(rulesResult.error),
    };
}

export async function updateAccessAccount(input: {
    id: string;
    source: 'profile' | 'legacy';
    role: AppRole;
    username?: string | null;
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    retail_crm_manager_id?: number | null;
    password?: string | null;
}) {
    const role = normalizeRole(input.role);
    const retailCrmManagerId = role === 'manager' ? normalizeManagerId(input.retail_crm_manager_id) : null;
    const updates = {
        role,
        username: input.username?.trim() || null,
        email: input.email?.trim() || null,
        first_name: input.first_name?.trim() || null,
        last_name: input.last_name?.trim() || null,
        retail_crm_manager_id: retailCrmManagerId,
    };

    if (input.source === 'profile') {
        const { error } = await supabase.from('profiles').update(updates).eq('id', input.id);
        if (error) throw error;

        if (input.password || updates.email) {
            const admin = getSupabaseAdmin();
            const { error: authError } = await admin.auth.admin.updateUserById(input.id, {
                ...(updates.email ? { email: updates.email } : {}),
                ...(input.password ? { password: input.password } : {}),
                user_metadata: {
                    username: updates.username,
                    first_name: updates.first_name,
                    last_name: updates.last_name,
                },
                app_metadata: {
                    role,
                    retail_crm_manager_id: retailCrmManagerId,
                },
            });
            if (authError) throw authError;
        }
    } else {
        const legacyUpdates: Record<string, any> = { ...updates };
        if (input.password) legacyUpdates.password_hash = input.password;
        const { error } = await supabase.from('users').update(legacyUpdates).eq('id', input.id);
        if (error) throw error;
    }

    revalidatePath('/settings/access');
    revalidatePath('/settings/profile');
    revalidatePath('/');
    return { success: true };
}

export async function createAccessAccount(input: {
    accountType: 'profile' | 'legacy';
    email?: string | null;
    username: string;
    password: string;
    first_name?: string | null;
    last_name?: string | null;
    role: AppRole;
    retail_crm_manager_id?: number | null;
}) {
    const username = input.username.trim();
    const password = input.password.trim();

    if (!username || !password) {
        throw new Error('Логин и пароль обязательны.');
    }

    const role = normalizeRole(input.role);
    const retailCrmManagerId = role === 'manager' ? normalizeManagerId(input.retail_crm_manager_id) : null;

    if (input.accountType === 'profile') {
        if (!input.email?.trim()) {
            throw new Error('Для Supabase-аккаунта нужен email.');
        }

        const admin = getSupabaseAdmin();
        const { data, error } = await admin.auth.admin.createUser({
            email: input.email.trim(),
            password,
            email_confirm: true,
            user_metadata: {
                username,
                first_name: input.first_name?.trim() || null,
                last_name: input.last_name?.trim() || null,
            },
            app_metadata: {
                role,
                retail_crm_manager_id: retailCrmManagerId,
            },
        });

        if (error) throw error;

        const { error: profileError } = await supabase
            .from('profiles')
            .update({
                email: input.email.trim(),
                username,
                first_name: input.first_name?.trim() || null,
                last_name: input.last_name?.trim() || null,
                role,
                retail_crm_manager_id: retailCrmManagerId,
            })
            .eq('id', data.user.id);

        if (profileError) throw profileError;
    } else {
        const { error } = await supabase.from('users').insert({
            email: input.email?.trim() || null,
            username,
            password_hash: password,
            first_name: input.first_name?.trim() || null,
            last_name: input.last_name?.trim() || null,
            role,
            retail_crm_manager_id: retailCrmManagerId,
        });

        if (error) throw error;
    }

    revalidatePath('/settings/access');
    return { success: true };
}

export async function saveRoutePermissions(routeRules: Array<{ prefix: string; allowed: AppRole[] }>) {
    const protectedRules = routeRules.map((rule) => {
        const defaultRule = DEFAULT_ROUTE_RULES.find((item) => item.prefix === rule.prefix);
        const allowed = normalizeAllowedRoles(rule.allowed);

        if (rule.prefix === '/settings/access' || rule.prefix === '/api/settings/access') {
            return {
                prefix: rule.prefix,
                label: defaultRule?.label || rule.prefix,
                description: defaultRule?.description || '',
                category: defaultRule?.category || 'Доступ',
                allowed: Array.from(new Set<AppRole>(['admin', ...allowed])),
            };
        }

        return {
            prefix: rule.prefix,
            label: defaultRule?.label || rule.prefix,
            description: defaultRule?.description || '',
            category: defaultRule?.category || 'Доступ',
            allowed,
        };
    });

    const { error } = await supabase
        .from('access_route_rules')
        .upsert(protectedRules.map((rule) => ({
            prefix: rule.prefix,
            label: rule.label,
            description: rule.description,
            category: rule.category,
            allowed_roles: rule.allowed,
            updated_at: new Date().toISOString(),
        })), { onConflict: 'prefix' });

    if (error) {
        if (isMissingTableError(error)) {
            return { success: false, errorType: 'TABLE_MISSING' as const };
        }
        throw error;
    }

    clearRouteRulesCache();
    revalidatePath('/settings/access');
    revalidatePath('/');
    return { success: true };
}