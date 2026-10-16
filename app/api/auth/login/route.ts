import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/utils/supabase';
import { login, setSupabaseSession, verifyPassword, clearSupabaseCookies } from '@/lib/auth';
import { enrichManagerLinkedIdentity } from '@/lib/manager-identity';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

function createSupabaseAuthClient() {
    if (!supabaseUrl || !supabaseAnonKey) return null;

    return createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}

/**
 * Поиск учётки по логину или почте — БЕЗ учёта регистра.
 *
 * Фильтр PostgREST `eq` регистрозависим: человеку выдали логин «Yaroslav», он
 * набрал «yaroslav» и получил «Неверный логин или пароль» при верном пароле
 * (Ярослав, 15.10.2026). Телефон вдобавок сам ставит заглавную первую букву.
 *
 * Сначала пробуем точное совпадение — это обычный случай и один запрос.
 * Не нашли — ищем `ilike` и сверяем значение сами: `%` и `_` в логине для
 * `ilike` подстановочные, и без сверки нашёлся бы чужой.
 */
async function findByLogin(table: 'profiles' | 'users', columns: string, identifier: string) {
    const value = identifier.trim();
    if (!value) return null;

    // Запятые и скобки ломают фильтр PostgREST — такой логин ищем только по имени.
    const safe = /[,()]/.test(value) ? null : value;

    const exact = safe
        ? await supabase.from(table).select(columns).or(`username.eq.${safe},email.eq.${safe}`).limit(2)
        : await supabase.from(table).select(columns).eq('username', value).limit(2);
    const exactRow = (exact.data as any[] | null)?.[0];
    if (!exact.error && exactRow) return exactRow;

    if (!safe) return null;

    const loose = await supabase
        .from(table)
        .select(columns)
        .or(`username.ilike.${safe},email.ilike.${safe}`)
        .limit(5);
    if (loose.error) return null;

    const lower = value.toLowerCase();
    return (
        (loose.data as any[] | null)?.find(
            (row) =>
                String(row.username ?? '').toLowerCase() === lower ||
                String(row.email ?? '').toLowerCase() === lower,
        ) ?? null
    );
}

async function loadProfileByIdentifier(identifier: string) {
    const profile = await findByLogin(
        'profiles',
        'id, email, username, first_name, last_name, avatar_url, role, retail_crm_manager_id',
        identifier,
    );
    if (profile) return enrichManagerLinkedIdentity(profile);

    const user = await findByLogin('users', '*', identifier);
    if (user) return enrichManagerLinkedIdentity(user);

    return null;
}

async function loadProfileById(userId: string) {
    const profileResult = await supabase
        .from('profiles')
        .select('id, email, username, first_name, last_name, avatar_url, role, retail_crm_manager_id')
        .eq('id', userId)
        .maybeSingle();

    if (!profileResult.error && profileResult.data) {
        return enrichManagerLinkedIdentity(profileResult.data);
    }

    const userResult = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

    return userResult.error ? null : enrichManagerLinkedIdentity(userResult.data);
}

export async function POST(req: Request) {
    try {
        const { username, password } = await req.json();
        const identifier = String(username || '').trim();

        if (!identifier || !password) {
            return NextResponse.json({ error: 'Логин и пароль обязательны' }, { status: 400 });
        }

        const resolvedProfile = await loadProfileByIdentifier(identifier);
        const authClient = createSupabaseAuthClient();
        const emailForAuth = identifier.includes('@') ? identifier : resolvedProfile?.email || null;

        if (authClient && emailForAuth) {
            const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
                email: emailForAuth,
                password,
            });

            if (!authError && authData.session && authData.user) {
                const profile = await loadProfileById(authData.user.id);

                if (profile?.role) {
                    await setSupabaseSession({
                        accessToken: authData.session.access_token,
                        refreshToken: authData.session.refresh_token,
                        expiresAt: authData.session.expires_at ? new Date(authData.session.expires_at * 1000).toISOString() : null,
                        user: {
                            id: profile.id,
                            email: profile.email || authData.user.email || null,
                            username: profile.username || authData.user.email || null,
                            first_name: profile.first_name || null,
                            last_name: profile.last_name || null,
                            avatar_url: profile.avatar_url || null,
                            role: profile.role,
                            retail_crm_manager_id: profile.retail_crm_manager_id ?? null,
                        },
                    });

                    return NextResponse.json({
                        success: true,
                        user: {
                            username: profile.username || profile.email,
                            role: profile.role,
                        },
                    });
                }
            }
        }

        /**
         * Запасной вход — по логину ИЛИ по почте, без учёта регистра.
         *
         * В форме написано «Логин или email», но здесь искали только по
         * логину: человек вводил свою почту со старым паролем и получал
         * «Неверный логин или пароль» (Лариса Хоменко и Екатерина Симонова
         * 12.10.2026 — «не можем войти»).
         */
        const user = await findByLogin('users', '*', identifier);

        if (!user) {
            return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 });
        }

        /**
         * Пароль сверяем и как есть, и без крайних пробелов: его присылают в
         * мессенджере, и при копировании к нему липнет пробел или перевод
         * строки. Логин от этого защищён давно, пароль — не был.
         */
        const textMatches =
            (await verifyPassword(password, user.password_hash)) ||
            (await verifyPassword(String(password).trim(), user.password_hash));
        if (!textMatches) {
            return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 });
        }

        // Чистим возможный Supabase-токен от прошлого входа: getSession читает его
        // раньше легаси-куки, и без очистки личность подменяется (пустой
        // retail_crm_manager_id → пустые заказы ОКК и зарплата).
        clearSupabaseCookies();

        await login({
            id: user.id,
            username: user.username,
            role: user.role,
            retail_crm_manager_id: user.retail_crm_manager_id,
            first_name: user.first_name || null,
            last_name: user.last_name || null,
            email: user.email || null,
            avatar_url: user.avatar_url || null,
        });

        return NextResponse.json({
            success: true,
            user: { username: user.username, role: user.role }
        });
    } catch {
        return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
    }
}
