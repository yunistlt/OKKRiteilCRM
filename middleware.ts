import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { getDefaultPathForRole } from '@/lib/rbac';
import { canAccessPathServer } from '@/lib/rbac-server';

function applyNoStoreHeaders(response: NextResponse) {
    response.headers.set('Cache-Control', 'private, no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    response.headers.set('Surrogate-Control', 'no-store');
    return response;
}

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
        pathname.startsWith('/api/reactivation/track') ||
        pathname.startsWith('/api/widget');
    const isAuthRoute = pathname === '/login';
    const isProtectedRoute = !isPublicRoute;

    if (isProtectedRoute) {
        const session = await getSession(request);

        if (!session?.user) {
            if (pathname.startsWith('/api')) {
                return applyNoStoreHeaders(NextResponse.json({ error: 'Неавторизован' }, { status: 401 }));
            }
            return applyNoStoreHeaders(NextResponse.redirect(new URL('/login', request.url)));
        }

        if (!(await canAccessPathServer(session.user.role, pathname))) {
            if (pathname.startsWith('/api')) {
                return applyNoStoreHeaders(NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 }));
            }
            return applyNoStoreHeaders(NextResponse.redirect(new URL(getDefaultPathForRole(session.user.role), request.url)));
        }

        return applyNoStoreHeaders(NextResponse.next());
    }

    if (isAuthRoute) {
        const session = await getSession(request);
        if (session?.user) {
            return applyNoStoreHeaders(NextResponse.redirect(new URL(getDefaultPathForRole(session.user.role), request.url)));
        }

        return applyNoStoreHeaders(NextResponse.next());
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon-v2\\.png|images|.*\\.svg).*)'],
};
