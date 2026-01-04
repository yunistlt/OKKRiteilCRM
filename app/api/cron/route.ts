
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

// Import "Handlers" directly if possible, or use fetch if they are isolated.
// Ideally, we'd refactor logic into generic functions in `lib/` and call them here.
// But for now, let's use internal fetch to keep "Route" logic isolated or simply call the routes if they export GET.
// Calling route handlers directly can be tricky with Request objects.
// Best approach for quick automation: "Orchestrator" via fetch (loopback).

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Max allowed for hobby/pro

export async function GET(request: Request) {
    // Basic Auth or Vercel Cron header check
    const authHeader = request.headers.get('authorization');
    const cronHeader = request.headers.get('x-vercel-cron');

    // Allow if CRON or if valid secret (add secret later), effectively open for now for dev

    const baseUrl = new URL(request.url).origin;
    const report: string[] = [];

    try {
        // 1. Sync Telphin Calls
        console.log('--- CRON: Syncing Calls ---');
        const callsRes = await fetch(`${baseUrl}/api/sync/telphin`, {
            cache: 'no-store',
            headers: { 'x-triggered-by': 'cron' }
        });
        const callsJson = await callsRes.json();
        report.push(`Calls: ${callsJson.count || 0} fetched`);

        // 2a. Sync RetailCRM Orders (State)
        // This updates phone numbers/amounts for matching
        console.log('--- CRON: Syncing Orders (State) ---');
        const ordersRes = await fetch(`${baseUrl}/api/sync/retailcrm`, { cache: 'no-store' });
        const ordersJson = await ordersRes.json();
        report.push(`Orders: ${ordersJson.total_orders_fetched || 0} fetched`);

        // 2b. Sync Order History (Events)
        console.log('--- CRON: Syncing History ---');
        const histRes = await fetch(`${baseUrl}/api/sync/history`, { cache: 'no-store' });
        const histJson = await histRes.json();
        report.push(`History: ${histJson.saved_events || 0} saved`);

        // 3. Match Calls
        console.log('--- CRON: Matching ---');
        const matchRes = await fetch(`${baseUrl}/api/matching/process`, { cache: 'no-store' });
        const matchJson = await matchRes.json();
        report.push(`Matches: ${matchJson.matches_found || 0} new`);

        // 4. Run Rule Engine
        console.log('--- CRON: Rules ---');
        const rulesRes = await fetch(`${baseUrl}/api/rules/execute?hours=24`, { cache: 'no-store' });
        const rulesJson = await rulesRes.json();
        report.push(`Rules: ${rulesJson.success ? 'OK' : 'Fail'}`);

        return NextResponse.json({
            success: true,
            summary: report,
            timestamp: new Date().toISOString()
        });

    } catch (error: any) {
        console.error('CRON Failed:', error);
        return NextResponse.json({ success: false, error: error.message, report }, { status: 500 });
    }
}
