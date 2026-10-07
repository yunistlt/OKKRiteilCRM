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

export async function shouldRedirectToGate(request: NextRequest, session: AppSession): Promise<boolean> {
    if (request.method !== 'GET') return false;
    if (isFreePath(request.nextUrl.pathname)) return false;

    const user = session.user;
    const state = await gateState(user.id, user.role, user.retail_crm_manager_id ?? null);
    return state.blocked;
}
