// @ts-nocheck
import { NextResponse } from 'next/server';
import { calculateEfficiency } from '@/lib/efficiency';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const endDate = new Date();
        const to = endDate.toISOString().split('T')[0];
        endDate.setDate(endDate.getDate() - 30);
        const from = endDate.toISOString().split('T')[0];

        const report = await calculateEfficiency(from, to);

        return NextResponse.json({
            success: true,
            range: { from, to },
            data: report
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
