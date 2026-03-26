/**
 * GET /api/reactivation/logs — список логов рассылки с пагинацией
 */

import { NextResponse } from 'next/server';
import { getLogs } from '@/lib/reactivation-db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const campaign_id = searchParams.get('campaign_id') ?? undefined;
        const status = searchParams.get('status') ?? undefined;
        const page = parseInt(searchParams.get('page') ?? '1');
        const limit = parseInt(searchParams.get('limit') ?? '50');

        const { data, total } = await getLogs({ campaign_id, status, page, limit });

        return NextResponse.json({ success: true, data, total, page, limit });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
