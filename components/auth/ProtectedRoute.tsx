'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { AppRole } from '@/lib/auth';
import { canAccessPathWithRules, getDefaultPathForRole, hasRole } from '@/lib/rbac';
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
    const { user, loading, permissionRules } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const canAccess = pathname ? canAccessPathWithRules(user?.role, pathname, permissionRules) : hasRole(user?.role, allowed);

    useEffect(() => {
        if (!loading && user && !canAccess) {
            router.replace(getDefaultPathForRole(user.role));
        }
    }, [canAccess, loading, router, user]);

    if (loading) {
        return <>{fallback || null}</>;
    }

    if (!user || !canAccess) {
        return <>{fallback || null}</>;
    }

    return <>{children}</>;
}