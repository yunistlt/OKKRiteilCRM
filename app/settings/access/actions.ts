'use server';

import { revalidatePath } from 'next/cache';
import { AppRole } from '@/lib/auth';
import { APP_ROLES, DEFAULT_ROUTE_RULES, normalizeAllowedRoles, RouteRule } from '@/lib/rbac';
import { DEFAULT_ROLE_CAPABILITIES, normalizeRoleCapabilityProfile, RoleCapabilityProfile } from '@/lib/access-control';
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

type AccessActionResult = {
    success: boolean;
    message?: string;
    errorType?: 'TABLE_MISSING' | 'SCHEMA_MISMATCH' | 'CONFIGURATION' | 'UNKNOWN';
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

function isMissingColumnError(error: any) {
    return Boolean(
        error?.code === '42703' ||
        error?.message?.includes('column')
    );
}

function toAccessActionError(error: any): AccessActionResult {
    const message = typeof error?.message === 'string' ? error.message : '';

    if (isMissingTableError(error)) {
        return {
            success: false,
            errorType: 'TABLE_MISSING',
            message: 'В базе ещё нет нужной таблицы. Сначала примените SQL-миграцию.',
        };
    }

    if (isMissingColumnError(error)) {
        return {
            success: false,
            errorType: 'SCHEMA_MISMATCH',
            message: 'Структура таблиц в production отличается от локальной. Нужна миграция или выравнивание схемы.',
        };
    }

    if (message.includes('SUPABASE_SERVICE_ROLE_KEY') || message.includes('Supabase admin client requires')) {
        return {
            success: false,
            errorType: 'CONFIGURATION',
            message: 'На сервере не настроен SUPABASE_SERVICE_ROLE_KEY для управления Auth-пользователями.',
        };
    }

    return {
        success: false,
        errorType: 'UNKNOWN',
        message: message || 'Операция не выполнена из-за серверной ошибки.',
    };
}

async function updateAccountTableWithFallback(table: 'profiles' | 'users', id: string, updates: Record<string, any>) {
    const primary = await supabase.from(table).update(updates).eq('id', id);

    if (!primary.error) {
        return { error: null };
    }

    if (!isMissingColumnError(primary.error)) {
        return primary;
    }

    const fallbackUpdates = {
        role: updates.role,
        username: updates.username ?? null,
        first_name: updates.first_name ?? null,
        last_name: updates.last_name ?? null,
    };

    return supabase.from(table).update(fallbackUpdates).eq('id', id);
}

async function insertAccountTableWithFallback(table: 'profiles' | 'users', payload: Record<string, any>) {
    const primary = await supabase.from(table).insert(payload);

    if (!primary.error) {
        return { error: null };
    }

    if (!isMissingColumnError(primary.error)) {
        return primary;
    }

    const fallbackPayload = {
        id: payload.id,
        username: payload.username ?? null,
        first_name: payload.first_name ?? null,
        last_name: payload.last_name ?? null,
        role: payload.role,
        password_hash: payload.password_hash,
    };

    return supabase.from(table).insert(fallbackPayload);
}

async function loadAccountsTable(table: 'profiles' | 'users') {
    const primary = await supabase
        .from(table)
        .select('id, email, username, first_name, last_name, avatar_url, role, retail_crm_manager_id');

    if (!primary.error) {
        return primary.data || [];
    }

    if (isMissingTableError(primary.error)) {
        return [];
    }

    if (isMissingColumnError(primary.error)) {
        const fallback = await supabase
            .from(table)
            .select('id, username, first_name, last_name, role');

        if (!fallback.error) {
            return fallback.data || [];
        }

        if (isMissingTableError(fallback.error)) {
            return [];
        }

        throw fallback.error;
    }

    throw primary.error;
}

async function loadManagersTable() {
    const primary = await supabase
        .from('managers')
        .select('id, first_name, last_name, active')
        .order('last_name', { ascending: true, nullsFirst: false });

    if (!primary.error) {
        return primary.data || [];
    }

    if (isMissingColumnError(primary.error)) {
        const fallback = await supabase
            .from('managers')
            .select('id, first_name, last_name')
            .order('last_name', { ascending: true, nullsFirst: false });

        if (!fallback.error) {
            return (fallback.data || []).map((item: any) => ({ ...item, active: true }));
        }

        throw fallback.error;
    }

    throw primary.error;
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
    roleCapabilities: RoleCapabilityProfile[];
    roleCapabilitiesTableReady: boolean;
}> {
    const [profilesRows, usersRows, managersRows, rulesResult, roleCapabilitiesResult] = await Promise.all([
        loadAccountsTable('profiles'),
        loadAccountsTable('users'),
        loadManagersTable(),
        supabase.from('access_route_rules').select('prefix, label, description, category, allowed_roles'),
        supabase.from('access_role_capabilities').select('role, data_scope, edit_scope, can_view_analytics, can_view_audit, can_view_reactivation, can_view_settings, can_manage_users, can_run_bulk_operations'),
    ]);

    if (rulesResult.error && !isMissingTableError(rulesResult.error)) throw rulesResult.error;
    if (roleCapabilitiesResult.error && !isMissingTableError(roleCapabilitiesResult.error)) throw roleCapabilitiesResult.error;

    const profiles: AccessAccount[] = profilesRows.map((item: any) => normalizeAccount(item, 'profile'));
    const legacyAccounts = usersRows
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

    const roleCapabilityMap = new Map<AppRole, RoleCapabilityProfile>(
        ((roleCapabilitiesResult.data || []) as any[]).map((item) => [
            item.role,
            normalizeRoleCapabilityProfile({
                role: item.role,
                dataScope: item.data_scope,
                editScope: item.edit_scope,
                canViewAnalytics: item.can_view_analytics,
                canViewAudit: item.can_view_audit,
                canViewReactivation: item.can_view_reactivation,
                canViewSettings: item.can_view_settings,
                canManageUsers: item.can_manage_users,
                canRunBulkOperations: item.can_run_bulk_operations,
            }),
        ])
    );

    const mergedRouteRules = DEFAULT_ROUTE_RULES.map((rule) => routeRuleMap.get(rule.prefix) || rule);
    const extraRouteRules = Array.from(routeRuleMap.values()).filter(
        (rule) => !DEFAULT_ROUTE_RULES.some((defaultRule) => defaultRule.prefix === rule.prefix)
    );

    return {
        accounts: sortAccounts([...profiles, ...legacyAccounts]),
        managers: managersRows.map((manager: any) => ({
            id: manager.id,
            label: [manager.first_name, manager.last_name].filter(Boolean).join(' ').trim() || `Manager #${manager.id}`,
            active: Boolean(manager.active),
        })),
        routeRules: [...mergedRouteRules, ...extraRouteRules],
        routeRulesTableReady: !Boolean(rulesResult.error),
        roleCapabilities: DEFAULT_ROLE_CAPABILITIES.map((item) => roleCapabilityMap.get(item.role) || item),
        roleCapabilitiesTableReady: !Boolean(roleCapabilitiesResult.error),
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
}): Promise<AccessActionResult> {
    try {
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
            const { error } = await updateAccountTableWithFallback('profiles', input.id, updates);
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
            const { error } = await updateAccountTableWithFallback('users', input.id, legacyUpdates);
            if (error) throw error;
        }

        revalidatePath('/settings/access');
        revalidatePath('/settings/profile');
        revalidatePath('/');
        return { success: true, message: 'Аккаунт сохранён.' };
    } catch (error: any) {
        return toAccessActionError(error);
    }
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
}): Promise<AccessActionResult> {
    try {
        const username = input.username.trim();
        const password = input.password.trim();

        if (!username || !password) {
            return { success: false, message: 'Логин и пароль обязательны.', errorType: 'UNKNOWN' };
        }

        const role = normalizeRole(input.role);
        const retailCrmManagerId = role === 'manager' ? normalizeManagerId(input.retail_crm_manager_id) : null;

        if (input.accountType === 'profile') {
            if (!input.email?.trim()) {
                return { success: false, message: 'Для Supabase-аккаунта нужен email.', errorType: 'UNKNOWN' };
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

            const { error: profileError } = await updateAccountTableWithFallback('profiles', data.user.id, {
                email: input.email.trim(),
                username,
                first_name: input.first_name?.trim() || null,
                last_name: input.last_name?.trim() || null,
                role,
                retail_crm_manager_id: retailCrmManagerId,
            });

            if (profileError) throw profileError;
        } else {
            const { error } = await insertAccountTableWithFallback('users', {
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
        return { success: true, message: 'Новый аккаунт создан.' };
    } catch (error: any) {
        return toAccessActionError(error);
    }
}

export async function saveRoutePermissions(routeRules: Array<{ prefix: string; allowed: AppRole[] }>): Promise<AccessActionResult> {
    try {
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
            return toAccessActionError(error);
        }

        clearRouteRulesCache();
        revalidatePath('/settings/access');
        revalidatePath('/');
        return { success: true, message: 'Матрица прав сохранена.' };
    } catch (error: any) {
        return toAccessActionError(error);
    }
}

export async function saveRoleCapabilities(roleCapabilities: RoleCapabilityProfile[]): Promise<AccessActionResult> {
    try {
        const payload = roleCapabilities.map((item) => {
            const normalized = normalizeRoleCapabilityProfile(item);
            return {
                role: normalized.role,
                data_scope: normalized.dataScope,
                edit_scope: normalized.editScope,
                can_view_analytics: normalized.canViewAnalytics,
                can_view_audit: normalized.canViewAudit,
                can_view_reactivation: normalized.canViewReactivation,
                can_view_settings: normalized.canViewSettings,
                can_manage_users: normalized.canManageUsers,
                can_run_bulk_operations: normalized.canRunBulkOperations,
                updated_at: new Date().toISOString(),
            };
        });

        const { error } = await supabase
            .from('access_role_capabilities')
            .upsert(payload, { onConflict: 'role' });

        if (error) {
            return toAccessActionError(error);
        }

        revalidatePath('/settings/access');
        return { success: true, message: 'Бизнес-права ролей сохранены.' };
    } catch (error: any) {
        return toAccessActionError(error);
    }
}