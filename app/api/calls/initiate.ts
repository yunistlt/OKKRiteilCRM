import { supabase } from '@/utils/supabase';
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

    const callSid = (telphinResponse.data as any).call_id;

    // Логируем исходящий звонок в БД
    const { data: callLog, error } = await supabase
      .from('outgoing_calls')
      .insert({
        call_sid: callSid,
        order_id: orderId ? parseInt(String(orderId)) : null,
        manager_id: parseInt(String(managerId)),
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

    let errorMessage = 'Failed to initiate call';
    let errorDetails: unknown = undefined;

    const axiosError = error as {
      isAxiosError?: boolean;
      response?: { data?: any };
      message?: string;
    };

    if (axiosError?.isAxiosError) {
      errorDetails = axiosError.response?.data;

      if (typeof axiosError.response?.data === 'string') {
        errorMessage = axiosError.response.data;
      } else if (axiosError.response?.data?.error) {
        errorMessage =
          typeof axiosError.response.data.error === 'string'
            ? axiosError.response.data.error
            : JSON.stringify(axiosError.response.data.error);
      } else if (axiosError.response?.data?.message) {
        errorMessage = axiosError.response.data.message;
      } else if (axiosError.message) {
        errorMessage = axiosError.message;
      }
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    return NextResponse.json(
      { error: errorMessage, details: errorDetails },
      { status: 500 }
    );
  }
}
