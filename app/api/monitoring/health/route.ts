
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const now = new Date();

        // 1. Check History Sync Freshness
        const { data: lastEvent, error } = await supabase
            .from('raw_order_events')
            .select('occurred_at')
            .order('occurred_at', { ascending: false })
            .limit(1)
            .single();

        if (error) throw error;

        let isHealthy = true;
        let lagMinutes = 0;
        let lastSyncTime = null;
        let message = 'All systems operational.';

        if (lastEvent) {
            lastSyncTime = new Date(lastEvent.occurred_at);
            const diffMs = now.getTime() - lastSyncTime.getTime();
            lagMinutes = Math.floor(diffMs / 1000 / 60);

            // Warning threshold: 2 hours (120 mins)
            if (lagMinutes > 120) {
                isHealthy = false;
                message = `CRITICAL: History Sync stalled! Last event was ${lagMinutes} minutes ago (${lastEvent.occurred_at}).`;

                // TODO: Integrate Telegram/Email alert here
                // await sendAdminAlert(message);
            }
        } else {
            isHealthy = false;
            message = 'CRITICAL: No events found in database.';
        }

        return NextResponse.json({
            success: true,
            healthy: isHealthy,
            lag_minutes: lagMinutes,
            last_sync: lastSyncTime,
            message: message,
            checked_at: now.toISOString()
        });

    } catch (e: any) {
        return NextResponse.json({
            success: false,
            healthy: false,
            message: `Health Check Failed: ${e.message}`
        }, { status: 500 });
    }
}
