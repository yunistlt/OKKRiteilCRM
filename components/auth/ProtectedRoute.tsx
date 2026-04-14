'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { AppRole } from '@/lib/auth';
import { getDefaultPathForRole, hasRole } from '@/lib/rbac';
import { useAuth } from '@/components/auth/AuthProvider';

export default function ProtectedRoute({
    allowed,
    children,
    fallback,
}: {
    allowed: AppRole[];
    children: React.ReactNode;
    fallback?: React.ReactNode;
}) {
    const { user, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading && user && !hasRole(user.role, allowed)) {
            router.replace(getDefaultPathForRole(user.role));
        }
    }, [allowed, loading, router, user]);

    if (loading) {
        return <>{fallback || null}</>;
    }

    if (!user || !hasRole(user.role, allowed)) {
        return <>{fallback || null}</>;
    }

    return <>{children}</>;
}