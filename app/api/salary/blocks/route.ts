import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { hasAnyRole } from '@/lib/rbac';
import { listBlocks } from '@/lib/salary/blocks/registry';
import { METRICS_CATALOG } from '@/lib/salary/blocks/metrics-catalog';

export const dynamic = 'force-dynamic';

// GET /api/salary/blocks — каталог блоков для конструктора (+ доступность данных).
export async function GET() {
    try {
        const session = await getSession();
        if (!hasAnyRole(session, ['admin', 'rop'])) {
            return NextResponse.json({ error: 'Доступ запрещен' }, { status: 403 });
        }
        return NextResponse.json({ blocks: listBlocks(), metrics: METRICS_CATALOG });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
