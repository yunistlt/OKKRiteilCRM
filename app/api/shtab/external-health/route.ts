import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { EXTERNAL_DB_TITLES, engineOfUrl, queryExternal } from '@/lib/shtab/external/client';
import type { ExternalDb } from '@/lib/shtab/external/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/shtab/external-health — почему внешняя база не отвечает.
//
// Нужен вот зачем: «данных цеха сейчас нет» Тамара говорит одинаково и когда
// база не настроена, и когда её не пускают, и когда сервер молчит. Причины
// разные, чинятся по-разному, а единственное место, где видна настоящая, —
// продакшен: локально та же учётка работает.
//
// Пароль не печатается ни в каком виде. Печатается то, по чему опознают
// расхождение: пользователь, хост, имя базы и длина пароля — этого хватает,
// чтобы понять, что в Vercel лежит другая строка, и не хватает, чтобы войти.

const DBS: ExternalDb[] = ['tseh', 'kb', 'marketing'];

const ENV_KEYS: Record<ExternalDb, string> = {
    tseh: 'SHTAB_DB_TSEH_URL',
    kb: 'SHTAB_DB_KB_URL',
    marketing: 'SHTAB_DB_MARKETING_URL',
};

/** Исходящий адрес: по нему заводят разрешение на чужом сервере. */
async function outboundIp(): Promise<string | null> {
    try {
        const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) });
        const data = await res.json();
        return typeof data?.ip === 'string' ? data.ip : null;
    } catch {
        return null;
    }
}

function describe(url: string): Record<string, unknown> {
    try {
        const u = new URL(url);
        return {
            engine: engineOfUrl(url),
            user: decodeURIComponent(u.username || ''),
            host: u.hostname,
            port: u.port || '(по умолчанию)',
            database: u.pathname.replace(/^\//, '') || '(не указана)',
            password_length: decodeURIComponent(u.password || '').length,
            has_query: Boolean(u.search),
        };
    } catch (e: any) {
        return { parse_error: e.message };
    }
}

/**
 * Что означает ошибка и что с ней делать.
 *
 * Без этого в ответе остаётся строка драйвера, по которой владельцу всё равно
 * придётся идти спрашивать — а ответов тут всего несколько, и они известны.
 */
function hint(error: string, code: string | null): string {
    const text = `${code ?? ''} ${error}`.toLowerCase();
    if (text.includes('access denied')) {
        return 'Сервер не принял учётку. Обычно это другой пароль в переменной окружения на проде, чем у живой учётки, либо у того же пользователя заведена вторая запись под конкретный хост — MySQL выбирает её и сверяет с её паролем. Сверь строку подключения в Vercel с рабочей и проверь SELECT user, host FROM mysql.user WHERE user = \'tamara_ro\'.';
    }
    if (text.includes('max_user_connections') || text.includes('too_many_user_connections')) {
        return 'Упёрлись в лимит одновременных соединений учётки. На Vercel функций много, каждая держит свой пул — лимит надо поднимать либо соединения закрывать агрессивнее.';
    }
    if (text.includes('max_questions') || text.includes('user_limit_reached')) {
        return 'Исчерпан часовой лимит запросов учётки. Лимит поднимается на сервере базы.';
    }
    if (text.includes('etimedout') || text.includes('timeout') || text.includes('econnrefused') || text.includes('ehostunreach')) {
        return 'Сервер не ответил. Проверь, пускает ли фаервол адрес, указанный выше как исходящий.';
    }
    if (text.includes('unknown database')) {
        return 'Имя базы в строке подключения не то.';
    }
    return 'Разбирать по тексту ошибки.';
}

export async function GET(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const checks = await Promise.all(
            DBS.map(async (db) => {
                const url = process.env[ENV_KEYS[db]]?.trim();
                if (!url) {
                    return { db, title: EXTERNAL_DB_TITLES[db], configured: false, env_key: ENV_KEYS[db] };
                }
                const started = Date.now();
                try {
                    const rows = (await queryExternal(db, 'SELECT 1 AS ok', [])) as any[];
                    return {
                        db,
                        title: EXTERNAL_DB_TITLES[db],
                        configured: true,
                        ok: rows.length > 0,
                        ms: Date.now() - started,
                        ...describe(url),
                    };
                } catch (e: any) {
                    return {
                        db,
                        title: EXTERNAL_DB_TITLES[db],
                        configured: true,
                        ok: false,
                        ms: Date.now() - started,
                        // Текст целиком: у MySQL в нём стоит адрес, с которого
                        // пришли, и это половина ответа на вопрос «почему».
                        error: e?.message ?? String(e),
                        code: e?.code ?? null,
                        hint: hint(e?.message ?? String(e), e?.code ?? null),
                        ...describe(url),
                    };
                }
            }),
        );

        // Кодировка указывается явно: этот ответ читает человек прямо в
        // браузере, а без charset Safari разбирает русский текст как cp1251 и
        // показывает кракозябры вместо разбора ошибки.
        return NextResponse.json(
            { outbound_ip: await outboundIp(), checks },
            { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
        );
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
