import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/utils/supabase';
import { login, setSupabaseSession, verifyPassword } from '@/lib/auth';
import { enrichManagerLinkedIdentity } from '@/lib/manager-identity';

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

async function loadProfileByIdentifier(identifier: string) {
    const normalized = identifier.trim();

    const profileResult = await supabase
        .from('profiles')
        .select('id, email, username, first_name, last_name, role, retail_crm_manager_id')
        .or(`email.eq.${normalized},username.eq.${normalized}`)
        .maybeSingle();

    if (!profileResult.error && profileResult.data) {
        return enrichManagerLinkedIdentity(profileResult.data);
    }

    const userResult = await supabase
        .from('users')
        .select('*')
        .eq('username', normalized)
        .maybeSingle();

    if (!userResult.error && userResult.data) {
        return enrichManagerLinkedIdentity(userResult.data);
    }

    return null;
}

async function loadProfileById(userId: string) {
    const profileResult = await supabase
        .from('profiles')
        .select('id, email, username, first_name, last_name, role, retail_crm_manager_id')
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

        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', identifier)
            .single();

        if (error || !user) {
            return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 });
        }

        const textMatches = await verifyPassword(password, user.password_hash);
        if (!textMatches) {
            return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 });
        }

        await login({
            id: user.id,
            username: user.username,
            role: user.role,
            retail_crm_manager_id: user.retail_crm_manager_id,
            first_name: user.first_name || null,
            last_name: user.last_name || null,
            email: user.email || null,
        });

        return NextResponse.json({
            success: true,
            user: { username: user.username, role: user.role }
        });
    } catch {
        return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
    }
}
