/**
 * Кто имеет право дёргать крон-роуты.
 *
 * Раньше проверка выглядела так: `if (process.env.CRON_SECRET && header !== ...)`.
 * Нет переменной — нет и проверки, а /api/cron/* в middleware.ts идёт мимо авторизации.
 * На проде CRON_SECRET задан не был, и любой крон-роут открывался снаружи без ключа:
 * можно было запускать синхронизации, рассылки и разборы.
 *
 * Теперь по умолчанию закрыто. Пропускаем только:
 *   1. запрос с правильным Bearer CRON_SECRET — основной способ;
 *   2. запрос от планировщика самого Vercel (заголовок x-vercel-cron, снаружи не
 *      подделывается: edge срезает клиентские x-vercel-*) — чтобы расписание работало
 *      и до того, как CRON_SECRET заведут в переменных окружения;
 *   3. админа с живой сессией — для кнопок «запустить сейчас» в интерфейсе.
 */
import type { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';

/** Проверка по заголовкам, без обращения к сессии. */
export function isCronHeaderAuthorized(req: NextRequest | Request): boolean {
    const headers = req.headers;
    const secret = process.env.CRON_SECRET;

    if (secret && headers.get('authorization') === `Bearer ${secret}`) return true;
    if (headers.get('x-vercel-cron')) return true;

    return false;
}

/** Полная проверка: заголовки либо живая сессия администратора. */
export async function isCronAuthorized(req: NextRequest | Request): Promise<boolean> {
    if (isCronHeaderAuthorized(req)) return true;

    try {
        const session = await getSession();
        return hasAnyRole(session, ['admin']);
    } catch {
        return false;
    }
}

/** Бросает 'Unauthorized' — крон-роуты ловят это и отвечают 401. */
export async function assertCronAuthorized(req: NextRequest | Request): Promise<void> {
    if (!(await isCronAuthorized(req))) {
        throw new Error('Unauthorized');
    }
}
