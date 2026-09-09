import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { verifyState } from '@/lib/shtab/google/crypto';
import { exchangeCode, saveToken } from '@/lib/shtab/google/oauth';

export const dynamic = 'force-dynamic';

// GET /api/shtab/google/callback — возврат с экрана согласия Google.
//
// Подпись state обязательна: без неё чужой запрос на этот адрес подсунул бы свой
// код авторизации, и к Штабу оказался бы привязан чужой календарь.

/** Почта аккаунта берётся из id_token — отдельного запроса за профилем не нужно. */
function emailFromIdToken(idToken?: string): string {
    if (!idToken) return '';
    const payload = idToken.split('.')[1];
    if (!payload) return '';
    try {
        const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return typeof json.email === 'string' ? json.email : '';
    } catch {
        return '';
    }
}

export async function GET(req: NextRequest) {
    const back = new URL('/shtab', req.nextUrl.origin);

    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const params = req.nextUrl.searchParams;
        const denied = params.get('error');
        if (denied) {
            back.searchParams.set('google', `отказано: ${denied}`);
            return NextResponse.redirect(back);
        }

        const code = params.get('code');
        const state = params.get('state');
        if (!code || !state || !verifyState(state)) {
            back.searchParams.set('google', 'подпись запроса не сошлась, подключение отменено');
            return NextResponse.redirect(back);
        }

        const token = await exchangeCode(code);
        if (!token.refresh_token) {
            // Без refresh-токена доступ умрёт через час и молча перестанет работать.
            back.searchParams.set('google', 'Google не выдал долгий доступ — отзовите доступ в аккаунте и подключите заново');
            return NextResponse.redirect(back);
        }

        await saveToken({
            accountEmail: emailFromIdToken((token as any).id_token),
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            expiresInSec: token.expires_in,
            scope: token.scope ?? '',
        });

        back.searchParams.set('google', 'календарь подключён');
        return NextResponse.redirect(back);
    } catch (e: any) {
        back.searchParams.set('google', `не вышло: ${e.message}`);
        return NextResponse.redirect(back);
    }
}
