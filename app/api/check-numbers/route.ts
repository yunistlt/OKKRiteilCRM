import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export async function GET() {
    // Fetch recent 10 orders to verify 'number' format
    const { data: orders, error } = await supabase
        .from('orders')
        .select('id, number, createdat, raw_payload')
        .order('createdat', { ascending: false })
        .limit(10);

    if (error) return NextResponse.json({ error }, { status: 500 });

    // Check if numbers look like externalIds (numeric) or internal (alphanumeric like 62C)
    const analysis = orders?.map(o => ({
        id: o.id,
        stored_number: o.number,
        raw_external: o.raw_payload?.externalId,
        raw_internal_number: o.raw_payload?.number,
        is_fixed: o.number == (o.raw_payload?.externalId || o.raw_payload?.number)
    }));

    return NextResponse.json({
        success: true,
        data: analysis
    });
}
