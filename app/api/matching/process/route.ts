import { NextResponse } from 'next/server';
import { processUnmatchedCalls } from '@/lib/call-matching';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

export async function GET(request: Request) {
    try {
        console.log('[Matching API] Starting matching process...');

        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '1000');

        // Use the library function directly for consistency and simplicity
        const matchesFound = await processUnmatchedCalls(limit);

        return NextResponse.json({
            success: true,
            matches_found: matchesFound
        });

    } catch (error: any) {
        console.error('[Matching API] Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
