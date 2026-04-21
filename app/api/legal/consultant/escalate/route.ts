import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/utils/supabase';

type EscalationBody = {
    topic?: string;
    transcript?: Array<{ role: 'user' | 'agent'; text: string }>;
    context?: Record<string, any> | null;
};

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const session = await getSession();

    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as EscalationBody;
    const topic = String(body.topic || 'Юридический вопрос').trim();
    const transcript = Array.isArray(body.transcript) ? body.transcript.slice(-8) : [];

    const { data, error } = await supabase
        .from('legal_audit_log')
        .insert({
            action: 'legal_escalation_requested',
            entity: 'legal_task',
            performed_by: session.user.id,
            details: {
                topic,
                transcript,
                context: body.context || null,
                requestedBy: {
                    id: session.user.id,
                    role: session.user.role,
                    email: session.user.email,
                    username: session.user.username,
                },
            },
        })
        .select('id')
        .single();

    if (error) {
        return NextResponse.json({ error: 'Не удалось зафиксировать эскалацию' }, { status: 500 });
    }

    return NextResponse.json({
        escalationId: data?.id || null,
        message: 'Задача для юриста зафиксирована в audit trail. Передайте ID юристу или используйте его в ручной обработке.',
    });
}