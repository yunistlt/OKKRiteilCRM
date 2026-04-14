import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

function canUseAudit(role: string | null | undefined) {
    return role && role !== 'manager';
}

export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
        }

        if (!canUseAudit(session.user.role)) {
            return NextResponse.json({ error: 'Недостаточно прав для аудита консультанта' }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const traceId = searchParams.get('traceId');
        const orderId = searchParams.get('orderId');
        const intent = searchParams.get('intent');
        const limit = Math.min(Number(searchParams.get('limit') || 40), 100);

        let query = supabase
            .from('okk_consultant_logs')
            .select('id, trace_id, thread_id, user_id, username, order_id, criterion_key, intent, question, answer_preview, used_fallback, created_at')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (traceId) query = query.eq('trace_id', traceId);
        if (orderId && !Number.isNaN(Number(orderId))) query = query.eq('order_id', Number(orderId));
        if (intent) query = query.eq('intent', intent);

        const { data: logs, error } = await query;
        if (error) throw error;

        let trace: any = null;
        if (traceId && logs?.[0]) {
            const { data: threadMessages, error: threadError } = await supabase
                .from('okk_consultant_messages')
                .select('id, role, content, created_at, metadata')
                .eq('thread_id', logs[0].thread_id)
                .order('created_at', { ascending: true });

            if (threadError) throw threadError;

            trace = {
                log: logs[0],
                messages: (threadMessages || [])
                    .filter((message: any) => message.metadata?.traceId === traceId)
                    .map((message: any) => ({
                        id: message.id,
                        role: message.role,
                        content: message.content,
                        created_at: message.created_at,
                        metadata: message.metadata || null,
                    })),
            };
        }

        return NextResponse.json({ logs: logs || [], trace });
    } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Не удалось загрузить аудит консультанта' }, { status: 500 });
    }
}