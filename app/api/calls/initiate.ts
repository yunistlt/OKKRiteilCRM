import { supabase } from '@/lib/supabase';
import axios from 'axios';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { phoneNumber, managerId, orderId } = await req.json();

    if (!phoneNumber || !managerId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Инициируем исходящий звонок через Telphin API
    const telphinResponse = await axios.post(
      `${process.env.TELPHIN_API_URL}/calls/initiate`,
      {
        phone_number: phoneNumber.replace(/\D/g, ''), // Очищаем номер
        manager_id: managerId,
        record: true,
        on_connect_url: `${process.env.BASE_URL}/api/calls/webhooks/connected`,
      },
      {
        headers: {
          'X-API-Key': process.env.TELPHIN_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    const callSid = telphinResponse.data.call_id;

    // Логируем исходящий звонок в БД
    const { data: callLog, error } = await supabase
      .from('outgoing_calls')
      .insert({
        call_sid: callSid,
        order_id: orderId || null,
        manager_id: managerId,
        phone_number: phoneNumber,
        status: 'initiated',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to log call:', error);
    }

    return NextResponse.json({
      success: true,
      callSid,
      status: 'initiated',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Call initiation error:', error);
    return NextResponse.json(
      { error: 'Failed to initiate call' },
      { status: 500 }
    );
  }
}
