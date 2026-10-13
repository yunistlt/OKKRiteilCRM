import type { NextRequest } from 'next/server';
import type { AppSession } from '@/lib/auth';
import { gateState } from '@/lib/read-gate/service';

/**
 * Нужно ли увести человека на документ.
 *
 * Шлюз держит только страницы: API не трогаем, иначе сама страница документа
 * не сможет ни отчитаться о времени, ни подтвердить прочтение. Выход и вход
 * тоже свободны — запирать человека в системе нельзя.
 */
const FREE_PREFIXES = ['/read-gate', '/login', '/logout', '/api', '/_next', '/invite', '/forgot-password', '/reset-password'];

export function isFreePath(pathname: string): boolean {
    return FREE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) || pathname.includes('.');
}

/** Куда вести человека: null — не трогаем, строка — адрес документа. */
export async function gateRedirectTarget(request: NextRequest, session: AppSession): Promise<string | null> {
    if (request.method !== 'GET') return null;

    const pathname = request.nextUrl.pathname;
    if (isFreePath(pathname)) return null;

    const user = session.user;
    const state = await gateState(user.id, user.role, user.retail_crm_manager_id ?? null);
    if (!state.blocked) return null;

    // У документа может быть своя страница — тогда ведём на неё, а не на
    // общий экран шлюза. Уже стоим на ней — не зацикливаем редирект.
    const own = state.document.url?.trim();
    if (own) return pathname === own ? null : own;
    return '/read-gate';
}
