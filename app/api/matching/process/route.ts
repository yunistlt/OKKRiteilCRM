import { NextResponse } from 'next/server';
import { processUnmatchedCalls } from '@/lib/call-matching';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
    try {
        console.log('[Matching API] Starting matching process...');

        // Use the library function directly for consistency and simplicity
        const matchesFound = await processUnmatchedCalls(500); // Analyze up to 500 unmatched calls

        return NextResponse.json({
            success: true,
            matches_found: matchesFound
        });

    } catch (error: any) {
        console.error('[Matching API] Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
