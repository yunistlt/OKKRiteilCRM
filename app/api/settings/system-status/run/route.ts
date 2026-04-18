import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

function resolveServiceUrl(serviceName: string) {
    if (serviceName.includes('Telphin Backfill')) return '/api/sync/telphin/recovery';
    if (serviceName.includes('Telphin Fallback')) return '/api/sync/telphin';
    if (serviceName.includes('RetailCRM Fallback')) return '/api/sync/retailcrm?force=true';
    if (serviceName.includes('System Jobs Queue')) return '/api/cron/system-jobs/watchdog';
    if (serviceName.includes('RetailCRM Delta Queue')) return '/api/cron/system-jobs/retailcrm-order-delta';
    if (serviceName.includes('RetailCRM History Queue')) return '/api/cron/system-jobs/retailcrm-history-delta';
    if (serviceName.includes('Order Context Queue')) return '/api/cron/system-jobs/order-context-refresh';
    if (serviceName.includes('Call Match Queue')) return '/api/cron/system-jobs/call-match';
    if (serviceName.includes('Manager Aggregate Queue')) return '/api/cron/system-jobs/manager-aggregate-refresh';
    if (serviceName.includes('Nightly Reconciliation')) return '/api/cron/system-jobs/nightly-reconciliation';
    if (serviceName.includes('Semantic Rules Queue')) return '/api/cron/system-jobs/call-semantic-rules';
    if (serviceName.includes('Matching Fallback')) return '/api/matching/process?force=true';
    if (serviceName.includes('Score Refresh Queue')) return '/api/cron/system-jobs/score-refresh';
    if (serviceName.includes('Insight Refresh Queue')) return '/api/cron/system-jobs/order-insight-refresh';
    if (serviceName.includes('Transcription Queue')) return '/api/cron/system-jobs/transcription';
    if (serviceName.includes('History Fallback')) return '/api/sync/history?force=true';
    if (serviceName.includes('Rule Engine')) return '/api/rules/execute?force=true';
    if (serviceName.includes('Priorities Refresh')) return '/api/analysis/priorities/refresh?force=true';
    if (serviceName.includes('AI Insight Agent')) return '/api/analysis/insights/run?force=true';
    if (serviceName.includes('Transcription Fallback')) return '/api/cron/transcribe?force=true';
    return null;
}

function needsCronAuth(url: string) {
    return url.startsWith('/api/cron/')
        || url.startsWith('/api/rules/execute')
        || url.startsWith('/api/analysis/priorities/refresh');
}

export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin'])) {
            return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const serviceName = typeof body?.serviceName === 'string' ? body.serviceName : '';
        const url = resolveServiceUrl(serviceName);

        if (!url) {
            return NextResponse.json({ ok: false, error: 'Unknown service' }, { status: 400 });
        }

        const headers: HeadersInit = {};
        if (needsCronAuth(url) && process.env.CRON_SECRET) {
            headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
        }

        const targetUrl = new URL(url, req.url).toString();
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers,
            cache: 'no-store',
        });

        const text = await response.text();

        return new NextResponse(text, {
            status: response.status,
            headers: {
                'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
            },
        });
    } catch (error: any) {
        return NextResponse.json({ ok: false, error: error.message || 'Failed to run service' }, { status: 500 });
    }
}