import { supabase } from '@/utils/supabase';
import axios from 'axios';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const envMockFlag = process.env.TELPHIN_MOCK_MODE === 'true';
const telphinApiUrl = process.env.TELPHIN_API_URL;
const telphinApiKey = process.env.TELPHIN_API_KEY;
const shouldMock =
  envMockFlag || !telphinApiUrl || !telphinApiKey;
const mockReason = !envMockFlag && shouldMock
  ? 'Telphin credentials missing, auto-mock enabled'
  : undefined;

export async function POST(req: NextRequest) {
  try {
    const {
      phoneNumber,
      managerId,
      orderId,
      simulateError = false,
      mockErrorMessage,
    } = await req.json();

    if (!phoneNumber || !managerId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    let callSid: string;

    if (shouldMock) {
      if (simulateError) {
        return NextResponse.json(
          { error: mockErrorMessage || 'Telphin mock error: failed to initiate call', mock: true },
          { status: 500 }
        );
      }

      callSid = `mock-${Date.now()}`;
    } else {
      const telphinResponse = await axios.post(
        `${telphinApiUrl}/calls/initiate`,
        {
          phone_number: phoneNumber.replace(/\D/g, ''),
          manager_id: managerId,
          record: true,
          on_connect_url: `${process.env.BASE_URL}/api/calls/webhooks/connected`,
        },
        {
          headers: {
            'X-API-Key': telphinApiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      callSid = (telphinResponse.data as any).call_id;
    }

    const { error } = await supabase
      .from('outgoing_calls')
      .insert({
        call_sid: callSid,
        order_id: orderId ? parseInt(String(orderId)) : null,
        manager_id: parseInt(String(managerId)),
        phone_number: phoneNumber,
        status: 'initiated',
        created_at: new Date().toISOString(),
      });

    if (error) {
      console.error('Failed to log call:', error);
    }

    return NextResponse.json({
      success: true,
      callSid,
      status: shouldMock ? 'mock_initiated' : 'initiated',
      timestamp: new Date().toISOString(),
      mock: shouldMock,
      mockReason,
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
