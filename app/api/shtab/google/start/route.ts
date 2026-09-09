import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { signState, tokenKeyConfigured } from '@/lib/shtab/google/crypto';
import { consentUrl, googleConfigured } from '@/lib/shtab/google/oauth';

export const dynamic = 'force-dynamic';

// GET /api/shtab/google/start — уводит владельца на экран согласия Google.
//
// Доступ admin-only: правило /api/shtab в lib/rbac.ts покрывает и этот маршрут.

export async function GET(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        if (!googleConfigured()) {
            return NextResponse.json(
                { error: 'Google Calendar не настроен: нужны GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI' },
                { status: 503 },
            );
        }
        if (!tokenKeyConfigured()) {
            // Без ключа шифрования refresh-токен пришлось бы хранить открытым.
            return NextResponse.json(
                { error: 'Нет SHTAB_TOKEN_KEY: без него токен Google негде хранить безопасно' },
                { status: 503 },
            );
        }

        return NextResponse.redirect(consentUrl(signState(String(session.user.id ?? 'owner'))));
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
