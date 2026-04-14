import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { enrichSessionWithManagerIdentity } from '@/lib/manager-identity';
import { getEffectiveRouteRules } from '@/lib/rbac-server';

export async function GET() {
    try {
        const [session, permissionRules] = await Promise.all([
            enrichSessionWithManagerIdentity(await getSession()),
            getEffectiveRouteRules(),
        ]);
        if (!session?.user) {
            return NextResponse.json({ authenticated: false }, { status: 401 });
        }

        return NextResponse.json({ authenticated: true, user: session.user, session, permissionRules });
    } catch {
        return NextResponse.json({ authenticated: false }, { status: 401 });
    }
}
