import { NextResponse } from 'next/server';
import { releaseRuntimeSyncLock, tryAcquireRuntimeSyncLock } from '@/lib/runtime-sync-locks';
import { runTelphinBacklogRecovery } from '@/lib/sync/telphin';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const TELPHIN_BACKFILL_LOCK_KEY = 'sync.telphin_backfill';
const TELPHIN_BACKFILL_LOCK_TTL_SECONDS = 280;

function isAuthorized(req: Request) {
    const authHeader = req.headers.get('authorization');
    return !process.env.CRON_SECRET || authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

async function persistTelphinBackfillLockState(status: 'idle' | 'running' | 'contended', holder?: string | null) {
    const now = new Date().toISOString();
    const entries = [
        {
            key: 'telphin_backfill_lock_status',
            value: status,
            updated_at: now,
        },
        {
            key: 'telphin_backfill_lock_holder',
            value: holder || '',
            updated_at: now,
        },
    ];

    const { error } = await supabase.from('sync_state').upsert(entries, { onConflict: 'key' });
    if (error) {
        console.error('[TelphinBackfillRoute] Failed to persist lock state:', error);
    }
}

export async function GET(request: Request) {
    if (!isAuthorized(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const forceResync = searchParams.get('force') === 'true';
    const hours = parseInt(searchParams.get('hours') || '24', 10);

    const lockHolder = `telphin-backfill:${Date.now()}`;
    const lockAcquired = await tryAcquireRuntimeSyncLock({
        lockKey: TELPHIN_BACKFILL_LOCK_KEY,
        holder: lockHolder,
        ttlSeconds: TELPHIN_BACKFILL_LOCK_TTL_SECONDS,
    });

    if (!lockAcquired) {
        await persistTelphinBackfillLockState('contended');
        return NextResponse.json({
            success: true,
            status: 'locked',
            reason: 'Telphin backlog recovery is already running in another worker.',
        });
    }

    try {
        await persistTelphinBackfillLockState('running', lockHolder);
        const result = await runTelphinBacklogRecovery(forceResync, hours);

        if (!result.success) {
            return NextResponse.json({ error: result.error }, { status: 500 });
        }

        return NextResponse.json(result);
    } finally {
        await releaseRuntimeSyncLock({
            lockKey: TELPHIN_BACKFILL_LOCK_KEY,
            holder: lockHolder,
        }).catch((error) => {
            console.error('[TelphinBackfillRoute] Failed to release runtime lock:', error);
        });
        await persistTelphinBackfillLockState('idle');
    }
}