import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { enrichSessionWithManagerIdentity } from '@/lib/manager-identity';

export async function GET() {
    try {
        const session = await enrichSessionWithManagerIdentity(await getSession());
        if (!session?.user) {
            return NextResponse.json({ authenticated: false }, { status: 401 });
        }

        return NextResponse.json({ authenticated: true, user: session.user, session });
    } catch {
        return NextResponse.json({ authenticated: false }, { status: 401 });
    }
}
