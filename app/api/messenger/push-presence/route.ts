import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getMessengerErrorMessage, isMissingMessengerRelationError } from '@/lib/messenger/error';
import { logMessengerError } from '@/lib/messenger/logger';
import { messengerPushPresenceBodySchema } from '@/lib/messenger/security';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const PUSH_RUNTIME_TABLES = ['messenger_push_presence', 'messenger_push_subscriptions'];
const PUSH_RUNTIME_MISSING_MESSAGE = 'Push runtime-таблицы ещё не применены в Supabase. Выполните SQL-миграции 20260420_messenger_push_subscriptions.sql и 20260420_messenger_push_runtime.sql.';

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
        if (isMissingMessengerRelationError(error, PUSH_RUNTIME_TABLES)) {
            return NextResponse.json({
                success: false,
                skipped: 'push_runtime_tables_missing',
                error: PUSH_RUNTIME_MISSING_MESSAGE,
            });
        }

        logMessengerError('push.presence', error, {
            userId,
            method: 'POST',
        });
        return NextResponse.json({ error: getMessengerErrorMessage(error, 'Не удалось обновить push-presence') }, { status: 500 });
    }
}