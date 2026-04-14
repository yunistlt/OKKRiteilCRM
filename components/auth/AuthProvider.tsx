'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { AppSession } from '@/lib/auth';
import type { RoleCapabilityProfile } from '@/lib/access-control';
import { DEFAULT_ROLE_CAPABILITIES } from '@/lib/access-control';
import type { RouteRule } from '@/lib/rbac';
import { DEFAULT_ROUTE_RULES } from '@/lib/rbac';

type AuthContextValue = {
    session: AppSession | null;
    user: AppSession['user'] | null;
    permissionRules: RouteRule[];
    roleCapabilities: RoleCapabilityProfile[];
    loading: boolean;
    refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
    children,
    initialSession,
    initialPermissionRules,
    initialRoleCapabilities,
}: {
    children: React.ReactNode;
    initialSession: AppSession | null;
    initialPermissionRules?: RouteRule[];
    initialRoleCapabilities?: RoleCapabilityProfile[];
}) {
    const [session, setSession] = useState<AppSession | null>(initialSession);
    const [permissionRules, setPermissionRules] = useState<RouteRule[]>(initialPermissionRules || DEFAULT_ROUTE_RULES);
    const [roleCapabilities, setRoleCapabilities] = useState<RoleCapabilityProfile[]>(initialRoleCapabilities || DEFAULT_ROLE_CAPABILITIES);
    const [loading, setLoading] = useState(false);

    const refresh = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/auth/me', { cache: 'no-store' });
            const payload = await response.json();
            setSession(response.ok && payload.authenticated ? payload.session || null : null);
            setPermissionRules(response.ok && payload.authenticated ? payload.permissionRules || DEFAULT_ROUTE_RULES : DEFAULT_ROUTE_RULES);
            setRoleCapabilities(response.ok && payload.authenticated ? payload.roleCapabilities || DEFAULT_ROLE_CAPABILITIES : DEFAULT_ROLE_CAPABILITIES);
        } catch {
            setSession(null);
            setPermissionRules(DEFAULT_ROUTE_RULES);
            setRoleCapabilities(DEFAULT_ROLE_CAPABILITIES);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setSession(initialSession);
        setPermissionRules(initialPermissionRules || DEFAULT_ROUTE_RULES);
        setRoleCapabilities(initialRoleCapabilities || DEFAULT_ROLE_CAPABILITIES);
    }, [initialPermissionRules, initialRoleCapabilities, initialSession]);

    const value = useMemo<AuthContextValue>(() => ({
        session,
        user: session?.user || null,
        permissionRules,
        roleCapabilities,
        loading,
        refresh,
    }), [loading, permissionRules, roleCapabilities, session]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);

    if (!context) {
        throw new Error('useAuth must be used inside AuthProvider');
    }

    return context;
}