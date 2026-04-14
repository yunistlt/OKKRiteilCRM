import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { canAccessPath, getDefaultPathForRole } from '@/lib/rbac';

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    const isPublicRoute =
        pathname === '/login' || 
        pathname.startsWith('/api/auth') || 
        pathname.startsWith('/api/cron') || 
        pathname.startsWith('/api/sync') ||
        pathname.startsWith('/api/matching') ||
        pathname.startsWith('/api/monitoring') ||
        pathname.startsWith('/api/reactivation/webhook') ||
        pathname.startsWith('/api/reactivation/pixel') ||
        pathname.startsWith('/api/reactivation/track');
    const isAuthRoute = pathname === '/login';
    const isProtectedRoute = !isPublicRoute;

    if (isProtectedRoute) {
        const session = await getSession(request);

        if (!session?.user) {
            if (pathname.startsWith('/api')) {
                return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
            }
            return NextResponse.redirect(new URL('/login', request.url));
        }

        if (!canAccessPath(session.user.role, pathname)) {
            if (pathname.startsWith('/api')) {
                return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
            }
            return NextResponse.redirect(new URL(getDefaultPathForRole(session.user.role), request.url));
        }

        return NextResponse.next();
    }

    if (isAuthRoute) {
        const session = await getSession(request);
        if (session?.user) {
            return NextResponse.redirect(new URL(getDefaultPathForRole(session.user.role), request.url));
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon-v2\\.png|images|.*\\.svg).*)'],
};
