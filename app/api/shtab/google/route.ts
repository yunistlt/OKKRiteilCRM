import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';
import { tokenKeyConfigured } from '@/lib/shtab/google/crypto';
import { googleConfigured } from '@/lib/shtab/google/oauth';
import { CALENDAR_TITLE } from '@/lib/shtab/google/calendar';

export const dynamic = 'force-dynamic';

// GET /api/shtab/google — подключён ли календарь и всё ли настроено.
//
// Токены отсюда не возвращаются никогда: экрану нужно знать только факт
// подключения и почту аккаунта.

export async function GET(req: NextRequest) {
    try {
        const session = await getSession(req);
        if (!session?.user) return NextResponse.json({ error: 'Неавторизован' }, { status: 401 });

        const { data, error } = await supabase
            .from('shtab_google_token')
            .select('account_email, calendar_id, updated_at')
            .eq('id', 1)
            .maybeSingle();
        if (error) throw new Error(error.message);

        return NextResponse.json({
            configured: googleConfigured() && tokenKeyConfigured(),
            connected: Boolean(data),
            account: data?.account_email ?? null,
            calendar: data?.calendar_id ? CALENDAR_TITLE : null,
            since: data?.updated_at ?? null,
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
