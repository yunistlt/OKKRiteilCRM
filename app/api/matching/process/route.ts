import { NextResponse } from 'next/server';
import { processUnmatchedCalls } from '@/lib/call-matching';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * API для запуска матчинга звонков с заказами
 * GET /api/matching/process
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '100');

        console.log(`[Matching] Processing up to ${limit} unmatched calls...`);

        const totalMatches = await processUnmatchedCalls(limit);

        return NextResponse.json({
            success: true,
            processed: limit,
            matches_created: totalMatches,
            message: `Processed ${limit} calls, created ${totalMatches} matches`
        });
    } catch (error: any) {
        console.error('[Matching] Error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
