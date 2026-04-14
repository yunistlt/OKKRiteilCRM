import type { AppRole, SessionUser } from '@/lib/auth';
import { DEFAULT_ROLE_CAPABILITIES, getRoleCapability, normalizeRoleCapabilityProfile, type RoleCapabilityProfile } from '@/lib/access-control';

const CAPABILITIES_CACHE_TTL_MS = 1000 * 30;

let cachedCapabilities: RoleCapabilityProfile[] | null = null;
let cachedAt = 0;

function getSupabaseRestConfig() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    if (!url || !key) {
        throw new Error('Access control loader requires NEXT_PUBLIC_SUPABASE_URL and a Supabase key.');
    }

    return { url, key };
}

function isMissingTableError(error: any) {
    return Boolean(
        error?.code === '42P01' ||
        error?.message?.includes('relation') ||
        error?.message?.includes('access_role_capabilities')
    );
}

export async function getEffectiveRoleCapabilities(): Promise<RoleCapabilityProfile[]> {
    if (cachedCapabilities && Date.now() - cachedAt < CAPABILITIES_CACHE_TTL_MS) {
        return cachedCapabilities;
    }

    try {
        const { url, key } = getSupabaseRestConfig();
        const response = await fetch(
            `${url}/rest/v1/access_role_capabilities?select=role,data_scope,edit_scope,can_view_analytics,can_view_audit,can_view_reactivation,can_view_settings,can_manage_users,can_run_bulk_operations&order=role.asc`,
            {
                headers: {
                    apikey: key,
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json',
                },
                next: { revalidate: 30 },
            }
        );

        if (!response.ok) {
            const errorPayload = await response.json().catch(() => null);
            const error = {
                code: errorPayload?.code,
                message: errorPayload?.message || `Failed to load access role capabilities (${response.status})`,
            };

            if (isMissingTableError(error)) {
                cachedCapabilities = DEFAULT_ROLE_CAPABILITIES;
                cachedAt = Date.now();
                return DEFAULT_ROLE_CAPABILITIES;
            }

            throw error;
        }

        const data = await response.json();
        const overrides = new Map<AppRole, RoleCapabilityProfile>(
            (data || []).map((item: any) => [
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

        cachedCapabilities = DEFAULT_ROLE_CAPABILITIES.map((item) => overrides.get(item.role) || item);
        cachedAt = Date.now();
        return cachedCapabilities;
    } catch (error) {
        console.error('[AccessControl] Failed to load role capabilities:', error);
        cachedCapabilities = DEFAULT_ROLE_CAPABILITIES;
        cachedAt = Date.now();
        return DEFAULT_ROLE_CAPABILITIES;
    }
}

export async function getEffectiveCapabilityForRole(role: AppRole | null | undefined): Promise<RoleCapabilityProfile> {
    const capabilities = await getEffectiveRoleCapabilities();
    return getRoleCapability(role, capabilities);
}

export function canAccessTargetManager(user: SessionUser | null | undefined, capability: RoleCapabilityProfile, targetManagerId: number | null | undefined): boolean {
    if (!user) return false;
    if (capability.dataScope === 'all' || capability.dataScope === 'team') return true;
    if (!targetManagerId) return true;
    return !!user.retail_crm_manager_id && user.retail_crm_manager_id === targetManagerId;
}

export function clearRoleCapabilitiesCache() {
    cachedCapabilities = null;
    cachedAt = 0;
}