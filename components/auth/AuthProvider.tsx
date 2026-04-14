'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { AppSession } from '@/lib/auth';

type AuthContextValue = {
    session: AppSession | null;
    user: AppSession['user'] | null;
    loading: boolean;
    refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, initialSession }: { children: React.ReactNode; initialSession: AppSession | null }) {
    const [session, setSession] = useState<AppSession | null>(initialSession);
    const [loading, setLoading] = useState(false);

    const refresh = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/auth/me', { cache: 'no-store' });
            const payload = await response.json();
            setSession(response.ok && payload.authenticated ? payload.session || null : null);
        } catch {
            setSession(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setSession(initialSession);
    }, [initialSession]);

    const value = useMemo<AuthContextValue>(() => ({
        session,
        user: session?.user || null,
        loading,
        refresh,
    }), [loading, session]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);

    if (!context) {
        throw new Error('useAuth must be used inside AuthProvider');
    }

    return context;
}