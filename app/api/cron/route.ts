import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function ensureAuthorized(req: NextRequest) {
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        throw new Error('Unauthorized');
    }
}

export async function GET(request: NextRequest) {
    try {
        ensureAuthorized(request);
        return NextResponse.json({
            success: true,
            status: 'deprecated',
            message: 'Legacy chained /api/cron orchestration has been removed. Matching, rule fallback, and priority refresh now run as separate cron routes.',
            replacements: [
                '/api/matching/process',
                '/api/rules/execute',
                '/api/analysis/priorities/refresh'
            ],
            timestamp: new Date().toISOString(),
        });

    } catch (error: any) {
        console.error('CRON Fatal Error:', error);
        const isUnauthorized = error.message === 'Unauthorized';
        return NextResponse.json(
            { success: false, error: error.message },
            { status: isUnauthorized ? 401 : 500 }
        );
    }
}
