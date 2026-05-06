import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const managerSession = await getSession(req);
    if (!managerSession) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const period = searchParams.get('period') || '30'; // дней
    const days = Math.min(Math.max(parseInt(period) || 30, 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    try {
        // Параллельные запросы
        const [
            sessionsRes,
            proposalsRes,
            invoicesRes,
        ] = await Promise.all([
            supabase
                .from('widget_sessions')
                .select('id, has_contacts, utm_source, utm_medium, utm_campaign, interested_products, created_at, updated_at')
                .gte('created_at', since),
            supabase
                .from('lead_proposals')
                .select('id, status, total_amount, viewed_at, sent_at, created_at, session_id')
                .gte('created_at', since),
            supabase
                .from('lead_invoices')
                .select('id, status, total_amount, viewed_at, sent_at, paid_at, created_at, session_id')
                .gte('created_at', since),
        ]);

        const sessions = sessionsRes.data || [];
        const proposals = proposalsRes.data || [];
        const invoices = invoicesRes.data || [];

        // --- Воронка конверсии ---
        const totalSessions = sessions.length;
        const withContacts = sessions.filter(s => s.has_contacts).length;
        const withProposal = new Set(proposals.map(p => p.session_id)).size;
        const withInvoice  = new Set(invoices.map(i => i.session_id)).size;
        const paidCount    = invoices.filter(i => i.status === 'paid').length;

        // --- Метрики КП ---
        const proposalsSent   = proposals.filter(p => p.sent_at).length;
        const proposalsViewed = proposals.filter(p => p.viewed_at).length;
        const proposalAmounts = proposals.map(p => p.total_amount || 0).filter(Boolean);
        const avgProposalAmt  = proposalAmounts.length
            ? Math.round(proposalAmounts.reduce((a, b) => a + b, 0) / proposalAmounts.length)
            : 0;

        // --- Метрики счётов ---
        const invoicesSent   = invoices.filter(i => i.sent_at).length;
        const invoicesPaid   = invoices.filter(i => i.status === 'paid');
        const paidAmounts    = invoicesPaid.map(i => i.total_amount || 0);
        const totalRevenue   = paidAmounts.reduce((a, b) => a + b, 0);
        const avgInvoiceAmt  = paidAmounts.length
            ? Math.round(totalRevenue / paidAmounts.length)
            : 0;

        // --- Топ UTM-источников ---
        const utmMap: Record<string, number> = {};
        for (const s of sessions) {
            const key = s.utm_source
                ? `${s.utm_source}${s.utm_medium ? `/${s.utm_medium}` : ''}`
                : '(прямой трафик)';
            utmMap[key] = (utmMap[key] || 0) + 1;
        }
        const topUtm = Object.entries(utmMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([source, count]) => ({ source, count }));

        // --- Топ интересующих товаров ---
        const productMap: Record<string, number> = {};
        for (const s of sessions) {
            if (Array.isArray(s.interested_products)) {
                for (const p of s.interested_products) {
                    productMap[p] = (productMap[p] || 0) + 1;
                }
            }
        }
        const topProducts = Object.entries(productMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([product, count]) => ({ product, count }));

        // --- Динамика по дням (лиды по дням за последние 30 дней) ---
        const dailyMap: Record<string, { sessions: number; proposals: number; paid: number }> = {};
        const normalize = (dt: string) => dt.slice(0, 10); // YYYY-MM-DD

        // Инициализация последних N дней
        const chartDays = Math.min(days, 30);
        for (let i = chartDays - 1; i >= 0; i--) {
            const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
            const key = d.toISOString().slice(0, 10);
            dailyMap[key] = { sessions: 0, proposals: 0, paid: 0 };
        }
        for (const s of sessions) {
            const k = normalize(s.created_at);
            if (dailyMap[k]) dailyMap[k].sessions++;
        }
        for (const p of proposals) {
            const k = normalize(p.created_at);
            if (dailyMap[k]) dailyMap[k].proposals++;
        }
        for (const i of invoicesPaid) {
            const k = normalize(i.paid_at || i.created_at);
            if (dailyMap[k]) dailyMap[k].paid++;
        }
        const dailyChart = Object.entries(dailyMap).map(([date, v]) => ({ date, ...v }));

        return NextResponse.json({
            period: days,
            since,
            funnel: {
                sessions:     totalSessions,
                with_contacts: withContacts,
                with_proposal: withProposal,
                with_invoice:  withInvoice,
                paid:          paidCount,
            },
            proposals: {
                total:     proposals.length,
                sent:      proposalsSent,
                viewed:    proposalsViewed,
                avg_amount: avgProposalAmt,
            },
            invoices: {
                total:       invoices.length,
                sent:        invoicesSent,
                paid:        invoicesPaid.length,
                total_revenue: totalRevenue,
                avg_amount:  avgInvoiceAmt,
            },
            top_utm:      topUtm,
            top_products: topProducts,
            daily_chart:  dailyChart,
        });
    } catch (e: any) {
        console.error('[analytics] error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
