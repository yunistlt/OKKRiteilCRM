
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Max 5 minutes for Pro plan

export async function GET(request: Request) {
    const baseUrl = new URL(request.url).origin;
    const report: string[] = [];
    const startTime = Date.now();
    // Leave 20s buffer before the hard 300s limit kills us
    const TIMEOUT_THRESHOLD_MS = 280 * 1000;

    const checkBudget = (stepName: string) => {
        const elapsed = Date.now() - startTime;
        if (elapsed > TIMEOUT_THRESHOLD_MS) {
            console.warn(`[CRON] Skipping ${stepName}: Time budget exceeded (${(elapsed / 1000).toFixed(1)}s elapsed)`);
            report.push(`Skipped ${stepName}: Timeout`);
            return false;
        }
        return true;
    };

    try {
        console.log('--- CRON STARTED ---');

        // NOTE: Telphin, RetailCRM, and History syncs are now handled by separate Vercel Crons
        // This endpoint acts as the "Data Processor" (Matching -> Rules -> Analysis)

        // 1. Match Calls
        if (checkBudget('Matching')) {
            console.log('[CRON] Step 1: Matching');
            try {
                const matchRes = await fetch(`${baseUrl}/api/matching/process`, { cache: 'no-store' });
                const matchJson = await matchRes.json();
                report.push(`Matches: ${matchJson.matches_found || 0} new`);
            } catch (e: any) {
                console.error('[CRON] Matching Error:', e);
                report.push(`Matches: Error (${e.message})`);
            }
        }
        if (checkBudget('Matching')) {
            console.log('[CRON] Step 4: Matching');
            try {
                const matchRes = await fetch(`${baseUrl}/api/matching/process`, { cache: 'no-store' });
                const matchJson = await matchRes.json();
                report.push(`Matches: ${matchJson.matches_found || 0} new`);
            } catch (e: any) {
                console.error('[CRON] Matching Error:', e);
                report.push(`Matches: Error (${e.message})`);
            }
        }

        // 2. Run Rule Engine
        if (checkBudget('Rules')) {
            console.log('[CRON] Step 2: Rules');
            try {
                const rulesRes = await fetch(`${baseUrl}/api/rules/execute?hours=24`, { cache: 'no-store' });
                const rulesJson = await rulesRes.json();
                report.push(`Rules: ${rulesJson.success ? 'OK' : 'Fail'}`);
            } catch (e: any) {
                console.error('[CRON] Rules Error:', e);
                report.push(`Rules: Error (${e.message})`);
            }
        }
        // 3. Refresh Priorities (Stagnation calculation)
        if (checkBudget('Priorities')) {
            console.log('[CRON] Step 3: Priorities');
            try {
                const prioRes = await fetch(`${baseUrl}/api/analysis/priorities/refresh`, { cache: 'no-store' });
                const prioJson = await prioRes.json();
                report.push(`Priorities: ${prioJson.count || 0} updated`);
            } catch (e: any) {
                console.error('[CRON] Priorities Error:', e);
                report.push(`Priorities: Error (${e.message})`);
            }
        }

        const totalTime = (Date.now() - startTime) / 1000;
        console.log(`--- CRON FINISHED in ${totalTime.toFixed(1)}s ---`);

        return NextResponse.json({
            success: true,
            elapsed_seconds: totalTime,
            summary: report,
            timestamp: new Date().toISOString()
        });

    } catch (error: any) {
        console.error('CRON Fatal Error:', error);
        return NextResponse.json({ success: false, error: error.message, report }, { status: 500 });
    }
}
