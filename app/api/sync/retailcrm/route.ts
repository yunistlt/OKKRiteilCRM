import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

const RETAILCRM_URL = process.env.RETAILCRM_URL;
const RETAILCRM_KEY = process.env.RETAILCRM_API_KEY;

export async function GET() {
    if (!RETAILCRM_URL || !RETAILCRM_KEY) {
        return NextResponse.json({ error: 'RetailCRM config missing' }, { status: 500 });
    }

    try {
        // Example: Fetch last 100 orders
        const response = await fetch(`${RETAILCRM_URL}/api/v5/orders?apiKey=${RETAILCRM_KEY}&limit=100`, {
            method: 'GET',
        });

        if (!response.ok) {
            throw new Error(`External API error: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error('RetailCRM API returned failure');
        }

        const orders = data.orders.map((order: any) => ({
            id: order.id,
            number: order.number,
            status: order.status,
            totalSumm: order.totalSumm,
            createdAt: order.createdAt,
            managerId: order.managerId,
            // Add more fields as needed
        }));

        const { error } = await supabase.from('orders').upsert(orders);

        if (error) {
            console.error('Supabase Error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, count: orders.length });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
