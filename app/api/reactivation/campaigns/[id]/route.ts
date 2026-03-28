/**
 * GET   /api/reactivation/campaigns/[id]  — детали кампании
 * PATCH /api/reactivation/campaigns/[id]  — изменить статус
 */

import { NextResponse } from 'next/server';
import { getCampaignById, updateCampaignStatus, getLogs, getStats, deleteCampaign } from '@/lib/reactivation-db';

export const dynamic = 'force-dynamic';

export async function GET(
    _request: Request,
    { params }: { params: { id: string } }
) {
    try {
        const campaign = await getCampaignById(params.id);
        if (!campaign) {
            return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
        }

        const stats = await getStats(params.id);
        const { data: logs } = await getLogs({ campaign_id: params.id, limit: 10 });

        return NextResponse.json({ success: true, campaign, stats, recent_logs: logs });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: { id: string } }
) {
    try {
        const body = await request.json();
        const { status } = body as { status: 'active' | 'paused' | 'completed' };

        if (!['active', 'paused', 'completed'].includes(status)) {
            return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
        }

        await updateCampaignStatus(params.id, status);
        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}

export async function DELETE(
    _request: Request,
    { params }: { params: { id: string } }
) {
    try {
        await deleteCampaign(params.id);
        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
