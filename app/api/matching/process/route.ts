import { NextResponse } from 'next/server';
import { processUnmatchedCalls } from '@/lib/call-matching';
import { isSystemJobsPipelineRuntimeEnabled } from '@/lib/system-jobs';
import { recordWorkerFailure, recordWorkerSuccess } from '@/lib/system-worker-state';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes
const WORKER_KEY = 'fallback.matching';

export async function GET(request: Request) {
    try {
        console.log('[Matching API] Starting matching process...');

        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '1000');
        const force = searchParams.get('force') === 'true';
        const realtimePipelineEnabled = await isSystemJobsPipelineRuntimeEnabled();

        if (realtimePipelineEnabled && !force) {
            await recordWorkerSuccess(WORKER_KEY, { status: 'skipped', reason: 'realtime_owned' });
            return NextResponse.json({
                success: true,
                status: 'skipped',
                reason: 'Realtime pipeline owns production call matching. Use force=true for emergency fallback sweep.',
            });
        }

        // Use the library function directly for consistency and simplicity
        const matchesFound = await processUnmatchedCalls(limit);

        await recordWorkerSuccess(WORKER_KEY, {
            status: 'completed',
            limit,
            matches_found: matchesFound,
        });

        return NextResponse.json({
            success: true,
            matches_found: matchesFound
        });

    } catch (error: any) {
        console.error('[Matching API] Error:', error);
        await recordWorkerFailure(WORKER_KEY, error.message || 'Unknown matching fallback error');
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
