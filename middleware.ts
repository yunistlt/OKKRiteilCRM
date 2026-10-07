import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { getDefaultPathForRole, isReadOnlyRole } from '@/lib/rbac';
import { canAccessPathServer } from '@/lib/rbac-server';
import { shouldRedirectToGate } from '@/lib/read-gate/guard';

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
        pathname === '/forgot-password' ||
        pathname === '/reset-password' ||
        pathname.startsWith('/invite') ||
        pathname.startsWith('/api/auth') ||
        pathname.startsWith('/api/cron') ||
        // Служебный доступ консультанта ЦехУспеха: сессии у внешней системы нет,
        // поэтому маршрут закрыт не сессией, а токеном в самом обработчике.
        pathname.startsWith('/api/duty') ||
        // Связь с ЦехУспехом: сессии у завода нет и учётки мы им не заводим, поэтому оба маршрута
        // закрыты не сессией, а в самих обработчиках — страница просмотра заказа проверяет подпись
        // ссылки и её срок, а проверка номера заказа требует ключ X-Api-Key.
        pathname.startsWith('/api/external/tseh/') ||
        pathname === '/api/payments/tochka' ||
        pathname.startsWith('/api/sync') ||
        pathname.startsWith('/api/matching') ||
        pathname.startsWith('/api/monitoring') ||
        pathname.startsWith('/api/stt') ||
        pathname.startsWith('/api/telphin') ||
        // События телефонии: Телфин шлёт их своим сервером, сессии у него нет.
        // Маршрут закрыт не сессией, а ключом TELPHIN_WEBHOOK_SECRET в самом
        // обработчике (решение владельца 05.10.2026 — нужно оповещение во
        // время звонка, а не по его записи).
        pathname.startsWith('/api/calls/webhooks') ||
        pathname.startsWith('/api/widget') ||
        // Файлы приложения-установки: браузер обновляет воркер фоновым запросом,
        // и если тот упирается в редирект на вход, воркер остаётся старым
        // навсегда — интерфейс после выкатки не обновлялся, пока человек не
        // чистил кеш руками (инцидент 01.10.2026).
        pathname === '/messenger-sw.js' ||
        pathname === '/manifest.webmanifest';
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

        /**
         * Роль «только просмотр»: смотреть можно всё, что ей открыто, менять —
         * ничего. Проверяем здесь, а не в обработчиках: иначе первый же новый
         * маршрут окажется незакрытым (решение владельца 05.10.2026).
         */
        if (isReadOnlyRole(session.user.role) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
            return applyNoStoreHeaders(NextResponse.json(
                { error: 'У вашей роли доступ только на просмотр — изменения закрыты' },
                { status: 403 },
            ));
        }

        /**
         * Шлюз чтения: пока разбор не прочитан, любой маршрут ведёт на документ.
         * Проверка идёт ПОСЛЕ авторизации и только для страниц — API нужен самой
         * странице документа, чтобы отчитаться о времени и подтвердить прочтение.
         */
        if (await shouldRedirectToGate(request, session)) {
            return applyNoStoreHeaders(NextResponse.redirect(new URL('/read-gate', request.url)));
        }

        if (!(await canAccessPathServer(session.user.role, pathname))) {
            if (pathname.startsWith('/api')) {
                return applyNoStoreHeaders(NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 }));
            }

            const fallbackPath = getDefaultPathForRole(session.user.role);
            // Если домашняя страница роли закрыта для неё же, редирект туда уводит
            // браузер в бесконечный круг (ERR_TOO_MANY_REDIRECTS). В этом случае
            // возвращаем на вход, а не гоняем по кругу.
            if (fallbackPath === pathname || !(await canAccessPathServer(session.user.role, fallbackPath))) {
                return applyNoStoreHeaders(NextResponse.redirect(new URL('/login?error=no-access', request.url)));
            }

            return applyNoStoreHeaders(NextResponse.redirect(new URL(fallbackPath, request.url)));
        }

        return applyNoStoreHeaders(NextResponse.next());
    }

    if (isAuthRoute) {
        const session = await getSession(request);
        if (session?.user) {
            const fallbackPath = getDefaultPathForRole(session.user.role);
            // Не отправляем вошедшего туда, откуда его развернёт проверка прав,
            // иначе /login и домашняя страница начнут перекидывать друг на друга.
            if (await canAccessPathServer(session.user.role, fallbackPath)) {
                return applyNoStoreHeaders(NextResponse.redirect(new URL(fallbackPath, request.url)));
            }

            return applyNoStoreHeaders(NextResponse.next());
        }

        return applyNoStoreHeaders(NextResponse.next());
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon-v2\\.png|images|.*\\.svg).*)'],
};
