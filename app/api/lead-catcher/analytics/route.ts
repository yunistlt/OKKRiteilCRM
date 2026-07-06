import { NextResponse } from 'next/server';
import postgres from 'postgres';

export const dynamic = 'force-dynamic';

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || 'week'; // 'week' | 'month' | 'quarter' | 'year'

    if (!connectionString) {
        return NextResponse.json({ error: 'Database connection string missing' }, { status: 500 });
    }

    let intervalTrunc = 'day';
    let intervalBack = '7 days';

    if (range === 'month') {
        intervalTrunc = 'day';
        intervalBack = '30 days';
    } else if (range === 'quarter') {
        intervalTrunc = 'week';
        intervalBack = '90 days';
    } else if (range === 'year') {
        intervalTrunc = 'week';
        intervalBack = '365 days';
    }

    const sql = postgres(connectionString);

    try {
        const rows = await sql`
            SELECT 
                date_trunc(${intervalTrunc}, created_at)::date as period_start,
                COUNT(*)::int as total_dialogs,
                COUNT(CASE WHEN has_contacts = true THEN 1 END)::int as total_contacts,
                COUNT(CASE WHEN crm_order_id IS NOT NULL THEN 1 END)::int as total_orders
            FROM widget_sessions
            WHERE created_at >= NOW() - CAST(${intervalBack} AS INTERVAL)
            GROUP BY period_start
            ORDER BY period_start ASC
        `;

        const points = rows.map((r: any) => {
            const dateObj = new Date(r.period_start);
            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const formattedLabel = intervalTrunc === 'week' ? `W ${day}.${month}` : `${day}.${month}`;

            const dialogs = r.total_dialogs || 0;
            const contacts = r.total_contacts || 0;
            const orders = r.total_orders || 0;
            const conversion = dialogs > 0 ? parseFloat(((contacts / dialogs) * 100).toFixed(1)) : 0;

            return {
                label: formattedLabel,
                dialogs,
                contacts,
                orders,
                conversion
            };
        });

        return NextResponse.json({ points });
    } catch (err: any) {
        console.error('Analytics Fetch Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    } finally {
        await sql.end();
    }
}
