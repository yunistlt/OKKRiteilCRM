import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decrypt } from '@/lib/auth';

export async function middleware(request: NextRequest) {
    const sessionCookie = request.cookies.get('auth_session')?.value;
    const { pathname } = request.nextUrl;

    // Protect everything except explicit public routes
    const isPublicRoute = 
        pathname === '/login' || 
        pathname.startsWith('/api/auth') || 
        pathname.startsWith('/api/cron') || 
        pathname.startsWith('/api/sync') ||
        pathname.startsWith('/api/matching') ||
        pathname.startsWith('/api/rules') ||
        pathname.startsWith('/api/okk/run-all') ||
        pathname.startsWith('/api/analysis');
    const isAuthRoute = pathname === '/login';
    const isProtectedRoute = !isPublicRoute;

    if (isProtectedRoute) {
        if (!sessionCookie) {
            // Redirect to login if accessing protected route without a cookie
            if (pathname.startsWith('/api')) {
                return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });
            }
            return NextResponse.redirect(new URL('/login', request.url));
        }

        try {
            const payload = await decrypt(sessionCookie);
            const role = payload?.user?.role || payload?.role;

            if (role === 'manager') {
                // Allowed routes for manager
                const isOkkRoute = pathname === '/okk' || pathname.startsWith('/okk/');
                const isOkkApiRoute = pathname.startsWith('/api/okk');
                const isMessengerRoute = pathname === '/messenger' || pathname.startsWith('/messenger/');
                const isMessengerApiRoute = pathname.startsWith('/api/messenger');

                if (!isOkkRoute && !isOkkApiRoute && !isMessengerRoute && !isMessengerApiRoute) {
                    if (pathname.startsWith('/api')) {
                        return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
                    }
                    return NextResponse.redirect(new URL('/okk', request.url));
                }
            }

            return NextResponse.next();
        } catch (e) {
            // Invalid token
            if (pathname.startsWith('/api')) {
                return NextResponse.json({ error: 'Недействительная сессия' }, { status: 401 });
            }
            return NextResponse.redirect(new URL('/login', request.url));
        }
    }

    if (isAuthRoute) {
        if (sessionCookie) {
            try {
                const payload = await decrypt(sessionCookie);
                const role = payload?.user?.role || payload?.role;
                const target = role === 'manager' ? '/okk' : '/messenger';
                return NextResponse.redirect(new URL(target, request.url));
            } catch (e) {
                // Ignore expired token on login page
            }
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon-v2\\.png|images|.*\\.svg).*)'],
};
