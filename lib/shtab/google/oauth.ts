import { supabase } from '@/utils/supabase';
import { decryptToken, encryptToken } from '@/lib/shtab/google/crypto';

// Доступ к Google Calendar: вход в согласие и обновление токена.
//
// Права запрошены двумя узкими вместо одного широкого:
//
//   calendar.app.created — Тамара заводит СВОЙ календарь «Ритм Штаба» и пишет
//     только в него. В остальные события аккаунта она не может ни писать, ни
//     смотреть, и это ограничение на стороне Google, а не наша дисциплина.
//   calendar.freebusy   — видит занятость: когда занято, без содержания встреч.
//
// Вместе это даёт всё, что нужно ритму — подобрать слот, создать встречу, позвать
// участников. Разница с широким calendar только в том, что ошибка в нашем коде не
// сможет переписать личные события владельца.
//
// googleapis не тянем: для событий и freebusy это обычные REST-вызовы, а
// зависимость весит десятки мегабайт на каждой функции Vercel.

export const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/calendar.app.created',
    'https://www.googleapis.com/auth/calendar.freebusy',
];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/** Токен истёк, если до конца жизни осталось меньше этого. Запас на дорогу. */
const REFRESH_MARGIN_MS = 60_000;

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function googleConfig(): GoogleConfig {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
    if (!clientId || !clientSecret || !redirectUri) {
        throw new Error('Google Calendar не настроен: нужны GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI');
    }
    return { clientId, clientSecret, redirectUri };
}

export function googleConfigured(): boolean {
    return Boolean(
        process.env.GOOGLE_CLIENT_ID?.trim() &&
            process.env.GOOGLE_CLIENT_SECRET?.trim() &&
            process.env.GOOGLE_REDIRECT_URI?.trim(),
    );
}

export function consentUrl(state: string): string {
    const { clientId, redirectUri } = googleConfig();
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '),
        // offline — чтобы получить refresh-токен, иначе доступ умрёт через час.
        access_type: 'offline',
        // consent — чтобы refresh-токен пришёл и при повторном подключении:
        // Google выдаёт его только на первом согласии, если не просить заново.
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
    });
    return `${AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
};

async function postForm(url: string, body: Record<string, string>): Promise<TokenResponse> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
    });
    const data = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!res.ok) {
        throw new Error(`Google отказал (${res.status}): ${data.error_description || data.error || 'без объяснения'}`);
    }
    return data;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
    const { clientId, clientSecret, redirectUri } = googleConfig();
    return postForm(TOKEN_URL, {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
    });
}

export async function refreshAccess(refreshToken: string): Promise<TokenResponse> {
    const { clientId, clientSecret } = googleConfig();
    return postForm(TOKEN_URL, {
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
    });
}

// ── хранение ──────────────────────────────────────────────────────────────────

export type StoredToken = {
    account_email: string;
    access_token: string;
    refresh_token: string;
    expires_at: string;
    scope: string;
    calendar_id: string | null;
};

export async function saveToken(row: {
    accountEmail: string;
    accessToken: string;
    refreshToken: string;
    expiresInSec: number;
    scope: string;
}): Promise<void> {
    const { error } = await supabase.from('shtab_google_token').upsert(
        {
            id: 1,
            account_email: row.accountEmail,
            access_token: encryptToken(row.accessToken),
            refresh_token: encryptToken(row.refreshToken),
            expires_at: new Date(Date.now() + row.expiresInSec * 1000).toISOString(),
            scope: row.scope,
            updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
    );
    if (error) throw new Error(error.message);
}

export async function loadToken(): Promise<StoredToken | null> {
    const { data, error } = await supabase
        .from('shtab_google_token')
        .select('account_email, access_token, refresh_token, expires_at, scope, calendar_id')
        .eq('id', 1)
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
        account_email: data.account_email,
        access_token: decryptToken(data.access_token),
        refresh_token: decryptToken(data.refresh_token),
        expires_at: data.expires_at,
        scope: data.scope,
        calendar_id: data.calendar_id,
    };
}

/** Нужно ли обновлять доступ. Вынесено отдельно, чтобы проверяться тестом. */
export function isExpired(expiresAt: string, now = Date.now()): boolean {
    const ts = Date.parse(expiresAt);
    if (!Number.isFinite(ts)) return true;
    return ts - now <= REFRESH_MARGIN_MS;
}

/**
 * Действующий access-токен. Обновляет его, если срок вышел, и сохраняет новый.
 *
 * Отказ Google на обновлении — не временная неполадка: чаще всего это отозванный
 * доступ. Поэтому ошибка говорит владельцу, что делать, а не просто «401».
 */
export async function accessToken(): Promise<{ token: string; calendarId: string | null }> {
    const stored = await loadToken();
    if (!stored) throw new Error('Календарь не подключён. Подключить можно в Штабе, вкладка «Программы».');

    if (!isExpired(stored.expires_at)) {
        return { token: stored.access_token, calendarId: stored.calendar_id };
    }

    let fresh: TokenResponse;
    try {
        fresh = await refreshAccess(stored.refresh_token);
    } catch (e) {
        throw new Error(
            `Google не продлил доступ: ${(e as Error).message}. Скорее всего, доступ отозван — подключите календарь заново.`,
        );
    }

    await saveToken({
        accountEmail: stored.account_email,
        accessToken: fresh.access_token,
        // Google при обновлении refresh-токен обычно не присылает: оставляем старый.
        refreshToken: fresh.refresh_token || stored.refresh_token,
        expiresInSec: fresh.expires_in,
        scope: fresh.scope || stored.scope,
    });

    return { token: fresh.access_token, calendarId: stored.calendar_id };
}

export async function revokeAccess(): Promise<void> {
    const stored = await loadToken().catch(() => null);
    if (stored) {
        // Отзываем у Google, а не только забываем у себя: иначе выданное право
        // останется висеть в аккаунте владельца.
        await fetch(REVOKE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: stored.refresh_token }).toString(),
        }).catch(() => {});
    }
    const { error } = await supabase.from('shtab_google_token').delete().eq('id', 1);
    if (error) throw new Error(error.message);
}
