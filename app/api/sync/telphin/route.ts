import { NextResponse } from 'next/server';
import { releaseRuntimeSyncLock, tryAcquireRuntimeSyncLock } from '@/lib/runtime-sync-locks';
import { runTelphinSync } from '@/lib/sync/telphin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const TELPHIN_FALLBACK_LOCK_KEY = 'sync.telphin_fallback';
const TELPHIN_FALLBACK_LOCK_TTL_SECONDS = 280;

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const forceResync = searchParams.get('force') === 'true';
    const hours = parseInt(searchParams.get('hours') || '2');

    const lockHolder = `telphin-fallback:${Date.now()}`;
    const lockAcquired = await tryAcquireRuntimeSyncLock({
        lockKey: TELPHIN_FALLBACK_LOCK_KEY,
        holder: lockHolder,
        ttlSeconds: TELPHIN_FALLBACK_LOCK_TTL_SECONDS,
    });

    if (!lockAcquired) {
        return NextResponse.json({
            success: true,
            status: 'locked',
            reason: 'Telphin fallback sync is already running in another worker.',
        });
    }

    try {
        const result = await runTelphinSync(forceResync, hours);

        if (!result.success) {
            return NextResponse.json({ error: result.error }, { status: 500 });
        }

        return NextResponse.json(result);
    } finally {
        await releaseRuntimeSyncLock({
            lockKey: TELPHIN_FALLBACK_LOCK_KEY,
            holder: lockHolder,
        }).catch((error) => {
            console.error('[TelphinSyncRoute] Failed to release runtime lock:', error);
        });
    }
}
