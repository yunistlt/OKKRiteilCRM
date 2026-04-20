import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { logMessengerError } from '@/lib/messenger/logger';
import {
    messengerDeletePushSubscriptionBodySchema,
    messengerPatchPushSubscriptionBodySchema,
    messengerPushSubscriptionBodySchema,
} from '@/lib/messenger/security';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    let userId: number | null = null;

    try {
        const session = await getSession();
        userId = session?.user?.retail_crm_manager_id ?? null;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data, error } = await supabase
            .from('messenger_push_subscriptions')
            .select('endpoint, platform, browser, device_label, permission_state, last_seen_at, revoked_at, settings')
            .eq('user_id', userId)
            .is('revoked_at', null)
            .order('last_seen_at', { ascending: false });

        if (error) throw error;

        return NextResponse.json({ subscriptions: data || [] });
    } catch (error: unknown) {
        logMessengerError('push.get', error, {
            userId,
            method: 'GET',
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}

export async function PATCH(req: Request) {
    let userId: number | null = null;

    try {
        const session = await getSession();
        userId = session?.user?.retail_crm_manager_id ?? null;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const parsedBody = messengerPatchPushSubscriptionBodySchema.safeParse(await req.json());
        if (!parsedBody.success) {
            return NextResponse.json({ error: parsedBody.error.issues[0]?.message || 'Invalid request body' }, { status: 400 });
        }

        const { endpoint, settings } = parsedBody.data;

        const { data: currentSubscription, error: currentSubscriptionError } = await supabase
            .from('messenger_push_subscriptions')
            .select('settings')
            .eq('user_id', userId)
            .eq('endpoint', endpoint)
            .is('revoked_at', null)
            .maybeSingle();

        if (currentSubscriptionError) throw currentSubscriptionError;
        if (!currentSubscription) {
            return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
        }

        const mergedSettings = {
            ...((currentSubscription.settings as Record<string, unknown> | null) || {}),
            ...settings,
        };

        const { data, error } = await supabase
            .from('messenger_push_subscriptions')
            .update({
                settings: mergedSettings,
                updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId)
            .eq('endpoint', endpoint)
            .is('revoked_at', null)
            .select('endpoint, platform, browser, device_label, permission_state, last_seen_at, revoked_at, settings')
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, subscription: data });
    } catch (error: unknown) {
        logMessengerError('push.post', error, {
            userId,
            method: 'PATCH',
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    let userId: number | null = null;

    try {
        const session = await getSession();
        userId = session?.user?.retail_crm_manager_id ?? null;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const parsedBody = messengerPushSubscriptionBodySchema.safeParse(await req.json());
        if (!parsedBody.success) {
            return NextResponse.json({ error: parsedBody.error.issues[0]?.message || 'Invalid request body' }, { status: 400 });
        }

        const body = parsedBody.data;
        const now = new Date().toISOString();

        const { data, error } = await supabase
            .from('messenger_push_subscriptions')
            .upsert({
                user_id: userId,
                endpoint: body.endpoint,
                p256dh: body.keys.p256dh,
                auth: body.keys.auth,
                subscription: body,
                platform: body.platform || null,
                browser: body.browser || null,
                device_label: body.device_label || null,
                user_agent: body.user_agent || null,
                chat_scope: body.chat_scope || {},
                settings: body.settings || {},
                permission_state: body.permission_state || 'granted',
                revoked_at: null,
                last_seen_at: now,
                updated_at: now,
            }, { onConflict: 'endpoint' })
            .select('id, endpoint, platform, browser, device_label, permission_state, last_seen_at')
            .single();

        if (error) throw error;

        return NextResponse.json({ success: true, subscription: data });
    } catch (error: unknown) {
        logMessengerError('push.post', error, {
            userId,
            method: 'POST',
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
    let userId: number | null = null;

    try {
        const session = await getSession();
        userId = session?.user?.retail_crm_manager_id ?? null;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const parsedBody = messengerDeletePushSubscriptionBodySchema.safeParse(await req.json());
        if (!parsedBody.success) {
            return NextResponse.json({ error: parsedBody.error.issues[0]?.message || 'Invalid request body' }, { status: 400 });
        }

        const now = new Date().toISOString();
        const { error } = await supabase
            .from('messenger_push_subscriptions')
            .update({ revoked_at: now, updated_at: now, permission_state: 'default' })
            .eq('user_id', userId)
            .eq('endpoint', parsedBody.data.endpoint);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        logMessengerError('push.delete', error, {
            userId,
            method: 'DELETE',
        });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
}