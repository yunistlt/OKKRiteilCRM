import { NextResponse } from 'next/server';
import { getStoredPriorities } from '@/lib/prioritization';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET() {
    try {
        const priorities = await getStoredPriorities(2000);

        return NextResponse.json({
            ok: true,
            priorities
        });
    } catch (e: any) {
        console.error('[Priority API] Error:', e);
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
