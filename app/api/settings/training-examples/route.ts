import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

// GET - List all training examples with optional filters
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');
    const trafficLight = searchParams.get('traffic_light');

    let query = supabase
        .from('training_examples')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

    if (trafficLight && ['red', 'yellow', 'green'].includes(trafficLight)) {
        query = query.eq('traffic_light', trafficLight);
    }

    const { data, error, count } = await query;

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
        examples: data || [],
        total: count || 0,
        limit,
        offset
    });
}

// POST - Create a new training example
export async function POST(req: Request) {
    const body = await req.json();
    const { id, orderId, orderNumber, trafficLight, userReasoning, orderContext, createdBy } = body;

    // Validation
    if (!orderId || !orderNumber || !trafficLight || !userReasoning) {
        return NextResponse.json(
            { error: 'orderId, orderNumber, trafficLight, and userReasoning are required' },
            { status: 400 }
        );
    }

    if (!['red', 'yellow', 'green'].includes(trafficLight)) {
        return NextResponse.json(
            { error: 'trafficLight must be one of: red, yellow, green' },
            { status: 400 }
        );
    }

    const item: any = {
        order_id: orderId,
        order_number: orderNumber,
        traffic_light: trafficLight,
        user_reasoning: userReasoning,
        order_context: orderContext || {},
        created_by: createdBy || 'system'
    };

    if (id) {
        item.id = id;
    }

    const { data, error } = await supabase
        .from('training_examples')
        .upsert(item)
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: id ? 200 : 201 });
}

// DELETE - Remove a training example by ID
export async function DELETE(req: Request) {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
        return NextResponse.json({ error: 'id parameter required' }, { status: 400 });
    }

    const { error } = await supabase
        .from('training_examples')
        .delete()
        .eq('id', parseInt(id));

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}
