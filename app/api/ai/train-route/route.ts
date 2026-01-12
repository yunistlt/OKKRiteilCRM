
import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for safe RetailCRM updates

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { orderId, targetStatus, reasoning, orderContext } = body;

        if (!orderId || !targetStatus || !reasoning) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        console.log(`[TrainRoute] Processing order ${orderId} -> ${targetStatus}`);

        // 1. Fetch current order to get API credentials (if stored) or use env
        const RETAILCRM_URL = (process.env.RETAILCRM_URL || process.env.RETAILCRM_BASE_URL)?.replace(/\/$/, '');
        const RETAILCRM_KEY = (process.env.RETAILCRM_API_KEY || process.env.RETAILCRM_KEY)?.trim();

        if (!RETAILCRM_URL || !RETAILCRM_KEY) {
            throw new Error('RetailCRM configuration missing');
        }

        // 2. Fetch order from RetailCRM to get 'site' (required for update)
        const searchUrl = `${RETAILCRM_URL}/api/v5/orders?apiKey=${RETAILCRM_KEY}&filter[ids][]=${orderId}`;
        const searchRes = await fetch(searchUrl);
        const searchData = await searchRes.json();

        if (!searchData.success || !searchData.orders || searchData.orders.length === 0) {
            // Try by number as fallback if the ID passed was actually a number
            const searchUrl2 = `${RETAILCRM_URL}/api/v5/orders?apiKey=${RETAILCRM_KEY}&filter[numbers][]=${orderId}`;
            const searchRes2 = await fetch(searchUrl2);
            const searchData2 = await searchRes2.json();

            if (!searchData2.success || !searchData2.orders || searchData2.orders.length === 0) {
                throw new Error(`Order ${orderId} not found in RetailCRM`);
            }
            searchData.orders = searchData2.orders;
        }

        const retailOrder = searchData.orders[0];
        const site = retailOrder.site;
        const internalId = retailOrder.id;

        // 3. Update RetailCRM
        console.log(`[TrainRoute] Updating RetailCRM (ID: ${internalId}, Site: ${site})...`);
        const updateUrl = `${RETAILCRM_URL}/api/v5/orders/${internalId}/edit?apiKey=${RETAILCRM_KEY}&by=id&site=${site}`;

        // Prepare comment: Append reasoning if needed, or replace? 
        // User wants "manually write comment... assign status". 
        // So we use the reasoning as the manager comment.
        const requestBody = {
            status: targetStatus,
            managerComment: reasoning,
            customFields: {
                next_contact_date: null // Clear next contact date often required
            }
        };

        const updateRes = await fetch(updateUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ order: JSON.stringify(requestBody) })
        });

        const updateData = await updateRes.json();
        if (!updateData.success) {
            throw new Error(`RetailCRM Update Failed: ${JSON.stringify(updateData.errors || updateData.errorMsg)}`);
        }

        // 4. Update Local DB 'orders' table
        await supabase
            .from('orders')
            .update({
                status: targetStatus,
                manager_comment: reasoning,
                updated_at: new Date().toISOString()
            })
            .eq('id', orderId); // or internalId depending on how we store it. usually we store ID.

        // 5. Save Training Example
        // We use 'green' as dummy traffic_light, and store real target_status in context
        const trainingData = {
            order_id: internalId,
            order_number: retailOrder.number,
            traffic_light: 'green', // Default/Dummy
            user_reasoning: reasoning,
            order_context: {
                ...orderContext,
                target_status: targetStatus, // Crucial for routing training
                routing_training: true
            },
            created_by: 'manual_training_interface'
        };

        const { error: trainError } = await supabase
            .from('training_examples')
            .insert(trainingData);

        if (trainError) {
            console.error('[TrainRoute] Failed to save training example:', trainError);
            // Don't fail the whole request, as the operation succeeded
        }

        return NextResponse.json({ success: true, orderId: internalId, status: targetStatus });

    } catch (e: any) {
        console.error('[TrainRoute] Error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
