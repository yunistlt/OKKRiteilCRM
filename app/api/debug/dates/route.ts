import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export async function GET() {
    try {
        const getRange = async (table: string, col: string) => {
            const { data: min } = await supabase.from(table).select(col).order(col, { ascending: true }).limit(1).single();
            const { data: max } = await supabase.from(table).select(col).order(col, { ascending: false }).limit(1).single();
            const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
            return {
                min: min ? (min as any)[col] : 'N/A',
                max: max ? (max as any)[col] : 'N/A',
                count
            };
        };

        const orders = await getRange('orders', 'created_at');
        const calls = await getRange('calls', 'timestamp');
        const matches = await getRange('matches', 'created_at');

        return NextResponse.json({
            orders: { ...orders, range: `${orders.min} -> ${orders.max}` },
            calls: { ...calls, range: `${calls.min} -> ${calls.max}` },
            matches: { ...matches },
            intersection: 'Check if Orders range overlaps with Calls range'
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
