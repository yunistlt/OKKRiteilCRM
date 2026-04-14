import type { AppRole } from '@/lib/auth';

export type AccessDataScope = 'own' | 'team' | 'all';
export type AccessEditScope = 'own' | 'team' | 'all';

export type RoleCapabilityProfile = {
    role: AppRole;
    dataScope: AccessDataScope;
    editScope: AccessEditScope;
    canViewAnalytics: boolean;
    canViewAudit: boolean;
    canViewReactivation: boolean;
    canViewSettings: boolean;
    canManageUsers: boolean;
    canRunBulkOperations: boolean;
};

export const ROLE_DISPLAY_ORDER: AppRole[] = ['admin', 'manager', 'okk', 'rop'];

export const ROLE_LABELS: Record<AppRole, string> = {
    admin: 'Админ',
    manager: 'Менеджер ОП',
    okk: 'Контролёр ОКК',
    rop: 'РОП',
};

export const DATA_SCOPE_LABELS: Record<AccessDataScope, string> = {
    own: 'Только свои',
    team: 'Своя команда',
    all: 'Все данные',
};

export const EDIT_SCOPE_LABELS: Record<AccessEditScope, string> = {
    own: 'Только своё',
    team: 'Своя команда',
    all: 'Полное редактирование',
};

export const DEFAULT_ROLE_CAPABILITIES: RoleCapabilityProfile[] = [
    {
        role: 'admin',
        dataScope: 'all',
        editScope: 'all',
        canViewAnalytics: true,
        canViewAudit: true,
        canViewReactivation: true,
        canViewSettings: true,
        canManageUsers: true,
        canRunBulkOperations: true,
    },
    {
        role: 'manager',
        dataScope: 'own',
        editScope: 'own',
        canViewAnalytics: false,
        canViewAudit: false,
        canViewReactivation: false,
        canViewSettings: false,
        canManageUsers: false,
        canRunBulkOperations: false,
    },
    {
        role: 'okk',
        dataScope: 'all',
        editScope: 'team',
        canViewAnalytics: true,
        canViewAudit: true,
        canViewReactivation: false,
        canViewSettings: false,
        canManageUsers: false,
        canRunBulkOperations: false,
    },
    {
        role: 'rop',
        dataScope: 'team',
        editScope: 'team',
        canViewAnalytics: true,
        canViewAudit: true,
        canViewReactivation: true,
        canViewSettings: false,
        canManageUsers: false,
        canRunBulkOperations: true,
    },
];

export function normalizeDataScope(value: unknown): AccessDataScope {
    return value === 'own' || value === 'team' || value === 'all' ? value : 'own';
}

export function normalizeEditScope(value: unknown): AccessEditScope {
    return value === 'own' || value === 'team' || value === 'all' ? value : 'own';
}

export function normalizeRoleCapabilityProfile(input: Partial<RoleCapabilityProfile> & { role: AppRole }): RoleCapabilityProfile {
    const fallback = DEFAULT_ROLE_CAPABILITIES.find((item) => item.role === input.role)!;

    return {
        role: input.role,
        dataScope: normalizeDataScope(input.dataScope ?? fallback.dataScope),
        editScope: normalizeEditScope(input.editScope ?? fallback.editScope),
        canViewAnalytics: typeof input.canViewAnalytics === 'boolean' ? input.canViewAnalytics : fallback.canViewAnalytics,
        canViewAudit: typeof input.canViewAudit === 'boolean' ? input.canViewAudit : fallback.canViewAudit,
        canViewReactivation: typeof input.canViewReactivation === 'boolean' ? input.canViewReactivation : fallback.canViewReactivation,
        canViewSettings: typeof input.canViewSettings === 'boolean' ? input.canViewSettings : fallback.canViewSettings,
        canManageUsers: typeof input.canManageUsers === 'boolean' ? input.canManageUsers : fallback.canManageUsers,
        canRunBulkOperations: typeof input.canRunBulkOperations === 'boolean' ? input.canRunBulkOperations : fallback.canRunBulkOperations,
    };
}

export function getRoleCapability(role: AppRole | null | undefined, capabilities: RoleCapabilityProfile[]): RoleCapabilityProfile {
    if (!role) {
        return DEFAULT_ROLE_CAPABILITIES.find((item) => item.role === 'manager')!;
    }

    return capabilities.find((item) => item.role === role) || DEFAULT_ROLE_CAPABILITIES.find((item) => item.role === role)!;
}