import { randomBytes } from 'crypto';
import { supabase } from '@/utils/supabase';
import { getSupabaseAdmin } from '@/utils/supabase-admin';

/**
 * Восстановление пароля по почте.
 * Аккаунт может жить в public.profiles (Supabase Auth) или в legacy public.users.
 * Токены одноразовые, живут 1 час (см. migrations/20260624_password_reset.sql).
 */

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 час

export interface ResetTarget {
    user_id: string;
    source: 'users' | 'profile';
    email: string;
}

function normalizeEmail(email: string): string {
    return (email || '').trim().toLowerCase();
}

/** Найти аккаунт по email — сначала среди profiles, затем среди legacy users. */
export async function findAccountByEmail(email: string): Promise<ResetTarget | null> {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;

    // ilike без подстановочных символов = регистронезависимое точное совпадение.
    const profile = await supabase
        .from('profiles')
        .select('id, email')
        .ilike('email', normalized)
        .maybeSingle();

    if (!profile.error && profile.data?.email) {
        return { user_id: profile.data.id, source: 'profile', email: profile.data.email };
    }

    const legacy = await supabase
        .from('users')
        .select('id, email')
        .ilike('email', normalized)
        .maybeSingle();

    if (!legacy.error && legacy.data?.email) {
        return { user_id: legacy.data.id, source: 'users', email: legacy.data.email };
    }

    return null;
}

/** Создать одноразовый токен сброса. Возвращает токен или null при ошибке. */
export async function createResetToken(target: ResetTarget): Promise<string | null> {
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

    const { error } = await supabase.from('password_reset_tokens').insert({
        token,
        user_id: target.user_id,
        source: target.source,
        email: target.email,
        expires_at: expiresAt,
    });

    if (error) {
        console.error('[password-reset] не удалось создать токен:', error.message);
        return null;
    }

    return token;
}

export type ConsumeReason = 'invalid' | 'expired' | 'used' | 'error';
export interface ConsumeResult {
    ok: boolean;
    reason?: ConsumeReason;
}

/** Применить токен: проверить и установить новый пароль. */
export async function consumeResetToken(token: string, newPassword: string): Promise<ConsumeResult> {
    const normalized = (token || '').trim();
    if (!normalized) return { ok: false, reason: 'invalid' };

    const { data, error } = await supabase
        .from('password_reset_tokens')
        .select('id, user_id, source, email, expires_at, used_at')
        .eq('token', normalized)
        .maybeSingle();

    if (error || !data) return { ok: false, reason: 'invalid' };
    if (data.used_at) return { ok: false, reason: 'used' };
    if (new Date(data.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };

    try {
        if (data.source === 'profile') {
            const admin = getSupabaseAdmin();
            const { error: authError } = await admin.auth.admin.updateUserById(data.user_id, { password: newPassword });
            if (authError) throw authError;
        } else {
            // legacy: пароль хранится сырым текстом (см. lib/auth.ts verifyPassword)
            const { error: upErr } = await supabase
                .from('users')
                .update({ password_hash: newPassword })
                .eq('id', data.user_id);
            if (upErr) throw upErr;
        }
    } catch (e: any) {
        console.error('[password-reset] не удалось обновить пароль:', e?.message || e);
        return { ok: false, reason: 'error' };
    }

    // Гасим все незакрытые токены этого аккаунта (включая текущий).
    await supabase
        .from('password_reset_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('user_id', data.user_id)
        .is('used_at', null);

    return { ok: true };
}
