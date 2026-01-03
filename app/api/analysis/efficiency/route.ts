import { NextResponse } from 'next/server';
import { calculateEfficiency } from '@/lib/efficiency';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const from = searchParams.get('from');
        const to = searchParams.get('to');

        if (!from || !to) {
            return NextResponse.json({ error: 'Missing date range parameters (from, to)' }, { status: 400 });
        }

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
