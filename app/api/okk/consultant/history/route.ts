import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

const THREAD_TTL_DAYS = 30;

function normalizeOrderId(rawOrderId: unknown): number | null {
    const orderId = typeof rawOrderId === 'number' ? rawOrderId : rawOrderId ? Number(rawOrderId) : null;
    return orderId && !Number.isNaN(orderId) ? orderId : null;
}

async function archiveExpiredThreads(userId: string) {
    const expiresAt = new Date(Date.now() - THREAD_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase
        .from('okk_consultant_threads')
        .update({ archived_at: new Date().toISOString() })
        .eq('user_id', userId)
        .is('archived_at', null)
        .lt('updated_at', expiresAt);

    if (error) throw error;
}

async function getOrCreateThread(userId: string, username: string, orderId: number | null) {
    await archiveExpiredThreads(userId);

    const { data: existing, error: existingError } = await supabase
        .from('okk_consultant_threads')
        .select('*')
        .eq('user_id', userId)
        .is('archived_at', null)
        .eq('order_id', orderId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (existingError) throw existingError;
    if (existing) return existing;

    const { data: created, error: createError } = await supabase
        .from('okk_consultant_threads')
        .insert({
            user_id: userId,
            username,
            order_id: orderId,
            branch_key: 'main',
            title: orderId ? `Заказ #${orderId}` : 'Общий контекст ОКК',
        })
        .select('*')
        .single();

    if (createError) throw createError;
    return created;
}

async function listThreads(userId: string, orderId: number | null) {
    const query = supabase
        .from('okk_consultant_threads')
        .select('id, branch_key, title, updated_at, created_at, order_id')
        .eq('user_id', userId)
        .is('archived_at', null)
        .order('updated_at', { ascending: false })
        .limit(20);

    const scopedQuery = orderId === null ? query.is('order_id', null) : query.eq('order_id', orderId);
    const { data, error } = await scopedQuery;
    if (error) throw error;
    return data || [];
}

async function resolveActiveThread(params: {
    userId: string;
    username: string;
    orderId: number | null;
    threadId?: string | null;
}) {
    const { userId, username, orderId, threadId } = params;

    const threads = await listThreads(userId, orderId);
    let thread = null;

    if (threadId) {
        thread = threads.find((item: any) => item.id === threadId) || null;
    }

    if (!thread) {
        thread = threads[0] || null;
    }

    if (!thread) {
        thread = await getOrCreateThread(userId, username, orderId);
    }

    const nextThreads = threads.some((item: any) => item.id === thread.id)
        ? threads
        : [thread, ...threads];

    return {
        thread,
        threads: nextThreads,
    };
}

export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const rawOrderId = searchParams.get('orderId');
        const orderId = normalizeOrderId(rawOrderId);
        const threadId = searchParams.get('threadId');
        const userId = String(session.user.id);
        const username = String(session.user.username || 'user');

        const { thread, threads } = await resolveActiveThread({ userId, username, orderId, threadId });
        const { data: messages, error: messagesError } = await supabase
            .from('okk_consultant_messages')
            .select('id, role, content, created_at, metadata')
            .eq('thread_id', thread.id)
            .order('created_at', { ascending: true });

        if (messagesError) throw messagesError;

        return NextResponse.json({
            thread,
            threads,
            messages: (messages || []).map((message: any) => ({
                id: message.id,
                role: message.role,
                text: message.content,
                createdAt: message.created_at,
                metadata: message.metadata || null,
            })),
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Не удалось загрузить историю консультанта' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
        }

        const body = await req.json();
        const action = String(body.action || '').trim();
        const orderId = normalizeOrderId(body.orderId);
        const threadId = typeof body.threadId === 'string' ? body.threadId : null;
        const userId = String(session.user.id);
        const username = String(session.user.username || 'user');

        if (action !== 'reset' && action !== 'create_branch') {
            return NextResponse.json({ error: 'Неподдерживаемое действие' }, { status: 400 });
        }

        if (action === 'create_branch') {
            const title = String(body.title || '').trim() || (orderId ? `Разбор #${orderId}` : 'Новая тема ОКК');
            const branchKey = `branch-${crypto.randomUUID().slice(0, 8)}`;

            const { data: thread, error: createError } = await supabase
                .from('okk_consultant_threads')
                .insert({
                    user_id: userId,
                    username,
                    order_id: orderId,
                    branch_key: branchKey,
                    title,
                })
                .select('*')
                .single();

            if (createError) throw createError;

            const threads = await listThreads(userId, orderId);
            return NextResponse.json({ thread, threads });
        }

        if (threadId) {
            const { error: archiveError } = await supabase
                .from('okk_consultant_threads')
                .update({ archived_at: new Date().toISOString() })
                .eq('user_id', userId)
                .eq('id', threadId)
                .is('archived_at', null);

            if (archiveError) throw archiveError;
        } else {
            const { error: archiveError } = await supabase
                .from('okk_consultant_threads')
                .update({ archived_at: new Date().toISOString() })
                .eq('user_id', userId)
                .eq('order_id', orderId)
                .is('archived_at', null);

            if (archiveError) throw archiveError;
        }

        const { thread, threads } = await resolveActiveThread({ userId, username, orderId });

        return NextResponse.json({ thread, threads });
    } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Не удалось сбросить ветку консультанта' }, { status: 500 });
    }
}
