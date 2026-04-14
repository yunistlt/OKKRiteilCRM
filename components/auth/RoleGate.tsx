'use client';

import type { AppRole } from '@/lib/auth';
import { hasRole } from '@/lib/rbac';
import { useAuth } from '@/components/auth/AuthProvider';

export default function RoleGate({
    allowed,
    children,
    fallback = null,
}: {
    allowed: AppRole[];
    children: React.ReactNode;
    fallback?: React.ReactNode;
}) {
    const { user } = useAuth();

    if (!hasRole(user?.role, allowed)) {
        return <>{fallback}</>;
    }

    return <>{children}</>;
}