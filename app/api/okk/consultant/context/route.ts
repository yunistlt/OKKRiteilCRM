import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { buildOrderScoreExplanation, ConsultantOrder, enrichEvidenceWithOrder, OrderEvidence, sanitizeEvidenceForRole, sanitizeOrderForRole } from '@/lib/okk-consultant';
import { loadConsultantEvidence, loadConsultantOrder } from '@/lib/okk-consultant-context';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!session?.user) {
            return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const orderId = Number(searchParams.get('orderId') || '');
        if (!orderId || Number.isNaN(orderId)) {
            return NextResponse.json({ error: 'orderId обязателен' }, { status: 400 });
        }

        const retailCrmManagerId = session.user.retail_crm_manager_id ? Number(session.user.retail_crm_manager_id) : null;
        const rawOrder = await loadConsultantOrder(orderId, session.user.role || 'admin', retailCrmManagerId);
        const rawEvidence = await loadConsultantEvidence(orderId, 10);
        const order = sanitizeOrderForRole(rawOrder, session.user.role || 'admin');
        const evidence = sanitizeEvidenceForRole(enrichEvidenceWithOrder(rawOrder, rawEvidence), session.user.role || 'admin');

        return NextResponse.json({
            order,
            evidence,
            summary: buildOrderScoreExplanation(order),
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Не удалось загрузить контекст заказа' }, { status: 500 });
    }
}
