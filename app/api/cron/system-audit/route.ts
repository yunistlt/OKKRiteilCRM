
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';
import { sendTelegramNotification } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const report: string[] = [];
    let hasAnomalies = false;

    try {
        console.log('[SystemAuditor] Starting check...');

        // 1. Check for Stuck Transcriptions (Pending > 2 hours)
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const { count: pendingCount, error: pendingError } = await supabase
            .from('raw_telphin_calls')
            .select('*', { count: 'exact', head: true })
            .eq('transcription_status', 'pending')
            .lt('started_at', twoHoursAgo);

        if (pendingError) {
            report.push(`❌ DB Error (Pending Check): ${pendingError.message}`);
            hasAnomalies = true;
        } else if (pendingCount !== null && pendingCount > 0) {
            report.push(`⚠️ <b>Stuck Transcriptions:</b> ${pendingCount} calls (pending > 2h). Billing risk!`);
            hasAnomalies = true;
        } else {
            report.push(`✅ Transcriptions: OK (0 stuck)`);
        }

        // 2. Check Recent Violations (Did analysis run in last 24h?)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count: violCount, error: violError } = await supabase
            .from('okk_violations')
            .select('*', { count: 'exact', head: true })
            .gte('violation_time', oneDayAgo);

        if (violError) {
            report.push(`❌ DB Error (Violations Check): ${violError.message}`);
            hasAnomalies = true;
        } else if (violCount === 0) {
            // Not necessarily a critical error, but worth noting if we expect them daily
            report.push(`ℹ️ <b>No violations in 24h</b>. System quiet or analysis broken?`);
        } else {
            report.push(`✅ Violations: ${violCount} found in last 24h.`);
        }

        // 3. Database Connection Test (Simple Fetch)
        const { error: dbError } = await supabase.from('okk_rules').select('count', { count: 'exact', head: true });
        if (dbError) {
            report.push(`❌ <b>DB Connection Failed:</b> ${dbError.message}`);
            hasAnomalies = true;
        } else {
            report.push(`✅ DB Connection: OK`);
        }

        // Send Alert if Anomalies Found or periodically (e.g. daily summary)
        // Since this runs every 4 hours, and user wants "status", we might alert only on error for now?
        // OR always send a "System Health: OK" message? User asked for "control", implies visibility.
        // Let's send only if Anomalies OR if it's the 12:00 run?
        // Actually user said "chat telegram", implying they want to see it.
        // But every 4 hours might be spammy if everything is OK.
        // Let's send if anomalies found.

        if (hasAnomalies) {
            const message = `
<b>🤖 System Auditor Alert</b>
${report.join('\n')}
             `.trim();
            await sendTelegramNotification(message);
        } else {
            console.log('[SystemAuditor] All systems nominal. No alert sent.');
            // Uncomment to verify functionality initially:
            // await sendTelegramNotification(`<b>🤖 System Auditor: OK</b>\nNo anomalies found.`);
        }

        return NextResponse.json({
            success: !hasAnomalies,
            report
        });

    } catch (e: any) {
        console.error('[SystemAuditor] Fatal Error:', e);
        await sendTelegramNotification(`<b>🚨 System Auditor CRASHED</b>\n${e.message}`);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
