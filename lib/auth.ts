import { SignJWT, decodeJwt, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';

export type AppRole = 'admin' | 'okk' | 'rop' | 'manager';

export type SessionUser = {
    id: string;
    email: string | null;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
    role: AppRole;
    retail_crm_manager_id: number | null;
    auth_source: 'supabase' | 'legacy';
};

export type AppSession = {
    user: SessionUser;
    accessToken: string | null;
    refreshToken: string | null;
    expiresAt: string | null;
};

const secretKey = process.env.JWT_SECRET || 'okk-super-secret-key-32-chars-long-min';
const key = new TextEncoder().encode(secretKey);
const supabaseJwtKey = process.env.SUPABASE_JWT_SECRET
    ? new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET)
    : null;

const LEGACY_COOKIE = 'auth_session';
const SUPABASE_ACCESS_COOKIE = 'sb-access-token';
const SUPABASE_REFRESH_COOKIE = 'sb-refresh-token';

type RequestLike = {
    headers?: Headers;
    cookies?: {
        get: (name: string) => { value?: string } | undefined;
        getAll?: () => Array<{ name: string; value: string }>;
    };
};

function normalizeRole(rawRole: unknown): AppRole | null {
    if (rawRole === 'admin' || rawRole === 'okk' || rawRole === 'rop' || rawRole === 'manager') {
        return rawRole;
    }
    return null;
}

function normalizeRetailCrmManagerId(rawValue: unknown): number | null {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        return rawValue;
    }

    if (typeof rawValue === 'string' && rawValue.trim()) {
        const parsed = Number(rawValue);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

function buildSessionUser(input: {
    id: unknown;
    email?: unknown;
    username?: unknown;
    first_name?: unknown;
    last_name?: unknown;
    avatar_url?: unknown;
    role: unknown;
    retail_crm_manager_id?: unknown;
    auth_source: 'supabase' | 'legacy';
}): SessionUser | null {
    const role = normalizeRole(input.role);
    const id = typeof input.id === 'string' && input.id.trim() ? input.id : null;

    if (!role || !id) {
        return null;
    }

    return {
        id,
        email: typeof input.email === 'string' && input.email.trim() ? input.email : null,
        username: typeof input.username === 'string' && input.username.trim() ? input.username : null,
        first_name: typeof input.first_name === 'string' && input.first_name.trim() ? input.first_name : null,
        last_name: typeof input.last_name === 'string' && input.last_name.trim() ? input.last_name : null,
        avatar_url: typeof input.avatar_url === 'string' && input.avatar_url.trim() ? input.avatar_url : null,
        role,
        retail_crm_manager_id: normalizeRetailCrmManagerId(input.retail_crm_manager_id),
        auth_source: input.auth_source,
    };
}

function extractSupabaseAccessTokenFromCookieValue(cookieValue: string | undefined): string | null {
    if (!cookieValue) return null;

    try {
        const parsed = JSON.parse(cookieValue);

        if (typeof parsed === 'string') return parsed;

        if (Array.isArray(parsed)) {
            const token = parsed.find((item) => typeof item === 'string' && item.split('.').length === 3);
            return typeof token === 'string' ? token : null;
        }

        if (parsed && typeof parsed === 'object') {
            const accessToken = (parsed as Record<string, unknown>).access_token;
            return typeof accessToken === 'string' ? accessToken : null;
        }
    } catch {
        if (cookieValue.split('.').length === 3) {
            return cookieValue;
        }
    }

    return null;
}

function getCookieStore() {
    return cookies();
}

function readCookieValue(name: string, request?: RequestLike): string | undefined {
    if (request?.cookies) {
        return request.cookies.get(name)?.value;
    }

    return getCookieStore().get(name)?.value;
}

function readAllCookies(request?: RequestLike): Array<{ name: string; value: string }> {
    if (request?.cookies?.getAll) {
        return request.cookies.getAll();
    }

    return getCookieStore().getAll();
}

function readAccessTokenFromCookies(request?: RequestLike): string | null {
    const explicitToken = readCookieValue(SUPABASE_ACCESS_COOKIE, request)
        || readCookieValue('supabase-access-token', request)
        || readCookieValue('access_token', request);

    if (explicitToken) {
        return explicitToken;
    }

    const allCookies = readAllCookies(request);
    const supabaseAuthCookie = allCookies.find((cookie) => cookie.name.includes('-auth-token'))?.value;
    return extractSupabaseAccessTokenFromCookieValue(supabaseAuthCookie);
}

function readAuthHeaderToken(request?: RequestLike): string | null {
    const authorization = request?.headers?.get('authorization') || headers().get('authorization');
    if (!authorization?.toLowerCase().startsWith('bearer ')) return null;
    const token = authorization.slice(7).trim();
    return token || null;
}

async function parseSupabaseToken(token: string, request?: RequestLike): Promise<AppSession | null> {
    try {
        const payload = supabaseJwtKey
            ? (await jwtVerify(token, supabaseJwtKey, { algorithms: ['HS256'] })).payload
            : decodeJwt(token);

        const appMetadata = payload.app_metadata && typeof payload.app_metadata === 'object'
            ? payload.app_metadata as Record<string, unknown>
            : {};
        const userMetadata = payload.user_metadata && typeof payload.user_metadata === 'object'
            ? payload.user_metadata as Record<string, unknown>
            : {};
        const nestedUser = payload.user && typeof payload.user === 'object'
            ? payload.user as Record<string, unknown>
            : {};

        const user = buildSessionUser({
            id: typeof payload.sub === 'string' ? payload.sub : nestedUser.id,
            email: payload.email || nestedUser.email || userMetadata.email,
            username: nestedUser.username || appMetadata.username || userMetadata.username || payload.email,
            first_name: userMetadata.first_name || appMetadata.first_name || nestedUser.first_name,
            last_name: userMetadata.last_name || appMetadata.last_name || nestedUser.last_name,
            avatar_url: userMetadata.avatar_url || appMetadata.avatar_url || nestedUser.avatar_url,
            role: appMetadata.role || userMetadata.role || nestedUser.role || payload.role,
            retail_crm_manager_id: appMetadata.retail_crm_manager_id || userMetadata.retail_crm_manager_id || nestedUser.retail_crm_manager_id || payload.retail_crm_manager_id,
            auth_source: 'supabase',
        });

        if (!user) return null;

        return {
            user,
            accessToken: token,
            refreshToken: readCookieValue(SUPABASE_REFRESH_COOKIE, request) || null,
            expiresAt: typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : null,
        };
    } catch {
        return null;
    }
}

function normalizeLegacySession(payload: any): AppSession | null {
    const legacyUser = payload?.user;

    const user = buildSessionUser({
        id: legacyUser?.id,
        email: legacyUser?.email,
        username: legacyUser?.username,
        first_name: legacyUser?.first_name,
        last_name: legacyUser?.last_name,
        avatar_url: legacyUser?.avatar_url,
        role: legacyUser?.role,
        retail_crm_manager_id: legacyUser?.retail_crm_manager_id,
        auth_source: 'legacy',
    });

    if (!user) return null;

    const expiresAt = payload?.expires
        ? new Date(payload.expires).toISOString()
        : null;

    return {
        user,
        accessToken: null,
        refreshToken: null,
        expiresAt,
    };
}

export async function encrypt(payload: any) {
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(key);
}

export async function decrypt(input: string): Promise<any> {
    const { payload } = await jwtVerify(input, key, {
        algorithms: ['HS256'],
    });
    return payload;
}

export async function login(user: {
    id: string,
    username: string,
    role: string,
    retail_crm_manager_id: number | null,
    first_name?: string | null,
    last_name?: string | null,
    email?: string | null,
    avatar_url?: string | null,
}) {
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const session = await encrypt({ user, expires });

    const cookieStore = getCookieStore();
    cookieStore.set(LEGACY_COOKIE, session, {
        expires,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
    });
}

export async function setSupabaseSession(session: {
    accessToken: string;
    refreshToken?: string | null;
    user: Omit<SessionUser, 'auth_source'>;
    expiresAt?: string | null;
}) {
    const cookieStore = getCookieStore();
    const expires = session.expiresAt ? new Date(session.expiresAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);

    cookieStore.set(SUPABASE_ACCESS_COOKIE, session.accessToken, {
        expires,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
    });

    if (session.refreshToken) {
        cookieStore.set(SUPABASE_REFRESH_COOKIE, session.refreshToken, {
            expires,
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
        });
    }

    await login({
        id: session.user.id,
        username: session.user.username || session.user.email || 'user',
        role: session.user.role,
        retail_crm_manager_id: session.user.retail_crm_manager_id,
        first_name: session.user.first_name,
        last_name: session.user.last_name,
        email: session.user.email,
        avatar_url: session.user.avatar_url,
    });
}

export async function logout() {
    const cookieStore = getCookieStore();
    cookieStore.set(LEGACY_COOKIE, '', { expires: new Date(0), httpOnly: true, path: '/' });
    cookieStore.set(SUPABASE_ACCESS_COOKIE, '', { expires: new Date(0), httpOnly: true, path: '/' });
    cookieStore.set(SUPABASE_REFRESH_COOKIE, '', { expires: new Date(0), httpOnly: true, path: '/' });
}

export async function getSession(request?: RequestLike): Promise<AppSession | null> {
    const accessToken = readAuthHeaderToken(request) || readAccessTokenFromCookies(request);
    if (accessToken) {
        const supabaseSession = await parseSupabaseToken(accessToken, request);
        if (supabaseSession) {
            return supabaseSession;
        }
    }

    const session = readCookieValue(LEGACY_COOKIE, request);
    if (!session) return null;

    try {
        return normalizeLegacySession(await decrypt(session));
    } catch {
        return null;
    }
}

export async function verifyPassword(inputPassword: string, storedPasswordHash: string) {
    // In a real app we would use bcrypt, but per plan we are storing raw text for testing
    // To respect the implementation plan we will compare directly.
    return inputPassword === storedPasswordHash;
}
