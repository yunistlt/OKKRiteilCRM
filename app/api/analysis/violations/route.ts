import { NextResponse } from 'next/server';
import { detectViolations } from '@/lib/violations';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);

    // Default to basically "all time" (from 2024)
    const endDate = new Date();
    const startDate = new Date('2024-01-01');

    const start = searchParams.get('start') || startDate.toISOString();
    const end = searchParams.get('end') || endDate.toISOString();

    try {
        const violations = await detectViolations(start, end);
        return NextResponse.json({
            range: { start, end },
            count: violations.length,
            violations
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
