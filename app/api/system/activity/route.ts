
// @ts-nocheck
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const intervals = [
            { label: '15m', val: '15 minutes' },
            { label: '1h', val: '1 hour' },
            { label: '4h', val: '4 hours' },
        ];

        const metricsSettings = [
            { role: 'СЕМЁН (Архивариус)', table: 'orders', field: 'updated_at', label: 'Заказы (Sync)' },
            { role: 'СЕМЁН (Архивариус)', table: 'raw_telphin_calls', field: 'ingested_at', label: 'Звонки (Ingest)' },
            { role: 'АННА (Аналитик)', table: 'call_order_matches', field: 'matched_at', label: 'Матчи (Match)' },
            { role: 'АННА (Аналитик)', table: 'okk_order_scores', field: 'created_at', label: 'Оценки (Scores)' },
            { role: 'МАКСИМ (Аудитор)', table: 'okk_violations', field: 'detected_at', label: 'Нарушения (Alerts)' },
            { role: 'ИГОРЬ (Диспетчер)', table: 'order_priorities', field: 'updated_at', label: 'SLA (Priorities)' },
        ];

        const results: any[] = [];

        for (const m of metricsSettings) {
            const stats: Record<string, any> = { role: m.role, label: m.label, table: m.table };

            // Get counts for each interval
            for (const interval of intervals) {
                const limitDate = new Date(Date.now() - (
                    interval.val.includes('minutes') ? parseInt(interval.val) * 60000 :
                        interval.val.includes('hour') ? parseInt(interval.val) * 3600000 :
                            parseInt(interval.val) * 3600000
                )).toISOString();

                const { count } = await supabase
                    .from(m.table)
                    .select('*', { count: 'exact', head: true })
                    .gte(m.field, limitDate);

                stats[interval.label] = count || 0;
            }

            // Get last activity time
            const { data: lastItem } = await supabase
                .from(m.table)
                .select(m.field)
                .order(m.field, { ascending: false })
                .limit(1)
                .single();

            stats.last_activity = lastItem ? (lastItem as any)[m.field] : null;
            results.push(stats);
        }

        return NextResponse.json({
            ok: true,
            timestamp: new Date().toISOString(),
            throughput: results
        });

    } catch (e: any) {
        console.error('[Activity API] Error:', e);
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
