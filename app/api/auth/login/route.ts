import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { login, verifyPassword } from '@/lib/auth';

export async function POST(req: Request) {
    try {
        const { username, password } = await req.json();

        if (!username || !password) {
            return NextResponse.json({ error: 'Логин и пароль обязательны' }, { status: 400 });
        }

        const { data: user, error } = await supabase
            .from('users')
            .select('id, username, password_hash, role, retail_crm_manager_id')
            .eq('username', username)
            .single();

        if (error || !user) {
            return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 });
        }

        const textMatches = await verifyPassword(password, user.password_hash);
        if (!textMatches) {
            return NextResponse.json({ error: 'Неверный логин или пароль' }, { status: 401 });
        }

        // Create JWT and set cookie
        await login({
            id: user.id,
            username: user.username,
            role: user.role,
            retail_crm_manager_id: user.retail_crm_manager_id
        });

        return NextResponse.json({
            success: true,
            user: { username: user.username, role: user.role }
        });
    } catch (e: any) {
        return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
    }
}
