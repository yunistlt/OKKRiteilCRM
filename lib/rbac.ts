import type { AppSession, AppRole } from '@/lib/auth';

export const APP_ROLES: AppRole[] = ['admin', 'okk', 'rop', 'manager'];

type RouteRule = {
    prefix: string;
    allowed: AppRole[];
};

const ROUTE_RULES: RouteRule[] = [
    { prefix: '/admin/reactivation', allowed: ['admin', 'rop'] },
    { prefix: '/api/reactivation', allowed: ['admin', 'rop'] },
    { prefix: '/reactivation', allowed: ['admin', 'rop'] },
    { prefix: '/api/okk/consultant/logs', allowed: ['admin', 'okk', 'rop'] },
    { prefix: '/okk/audit', allowed: ['admin', 'okk', 'rop'] },
    { prefix: '/analytics', allowed: ['admin', 'okk', 'rop'] },
    { prefix: '/api/analysis', allowed: ['admin', 'okk', 'rop'] },
    { prefix: '/settings/profile', allowed: ['admin', 'okk', 'rop', 'manager'] },
    { prefix: '/settings', allowed: ['admin'] },
    { prefix: '/api/settings', allowed: ['admin'] },
    { prefix: '/api/rules', allowed: ['admin'] },
    { prefix: '/admin', allowed: ['admin'] },
];

export function isAppRole(value: unknown): value is AppRole {
    return typeof value === 'string' && APP_ROLES.includes(value as AppRole);
}

export function hasRole(role: AppRole | null | undefined, allowed: AppRole[]): boolean {
    return Boolean(role && allowed.includes(role));
}

export function hasAnyRole(session: AppSession | null | undefined, allowed: AppRole[]): boolean {
    return hasRole(session?.user?.role, allowed);
}

export function getDefaultPathForRole(role: AppRole | null | undefined): string {
    if (role === 'manager') return '/okk';
    if (role === 'rop') return '/reactivation';
    if (role === 'okk') return '/okk';
    return '/';
}

export function getAllowedRolesForPath(pathname: string): AppRole[] | null {
    const matchedRule = ROUTE_RULES.find((rule) => pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`));
    return matchedRule?.allowed || null;
}

export function canAccessPath(role: AppRole | null | undefined, pathname: string): boolean {
    const allowed = getAllowedRolesForPath(pathname);
    if (!allowed) return true;
    return hasRole(role, allowed);
}

export function isManager(role: AppRole | null | undefined): boolean {
    return role === 'manager';
}