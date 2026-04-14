import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { enrichSessionWithManagerIdentity } from '@/lib/manager-identity';
import { getEffectiveRouteRules } from '@/lib/rbac-server';
import { getEffectiveRoleCapabilities } from '@/lib/access-control-server';

export async function GET() {
    try {
        const [session, permissionRules, roleCapabilities] = await Promise.all([
            enrichSessionWithManagerIdentity(await getSession()),
            getEffectiveRouteRules(),
            getEffectiveRoleCapabilities(),
        ]);
        if (!session?.user) {
            return NextResponse.json({ authenticated: false }, { status: 401 });
        }

        return NextResponse.json({ authenticated: true, user: session.user, session, permissionRules, roleCapabilities });
    } catch {
        return NextResponse.json({ authenticated: false }, { status: 401 });
    }
}
