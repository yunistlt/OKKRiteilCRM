import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { logMessengerError } from '@/lib/messenger/logger';
import { messengerPushPresenceBodySchema } from '@/lib/messenger/security';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    let userId: number | null = null;

    try {
        const session = await getSession();
        userId = session?.user?.retail_crm_manager_id ?? null;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const parsedBody = messengerPushPresenceBodySchema.safeParse(await req.json());
        if (!parsedBody.success) {
            return NextResponse.json({ error: parsedBody.error.issues[0]?.message || 'Invalid request body' }, { status: 400 });
        }

        const now = new Date().toISOString();
        const { endpoint, tab_id, chat_id, page_path, page_visible, focused } = parsedBody.data;

        const { error } = await supabase
            .from('messenger_push_presence')
            .upsert({
                endpoint,
                tab_id,
                user_id: userId,
                chat_id: chat_id || null,
                page_path: page_path || null,
                page_visible,
                focused,
                last_seen_at: now,
                updated_at: now,
            }, { onConflict: 'endpoint,tab_id' });

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        logMessengerError('push.presence', error, {
            userId,
            method: 'POST',
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}