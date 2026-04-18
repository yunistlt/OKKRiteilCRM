import axios from 'axios';
import { NextRequest, NextResponse } from 'next/server';
import { bestEffortInsertOutgoingLegacyCall } from '@/lib/telphin-legacy-compat';
import { upsertCanonicalTelphinCall } from '@/lib/telphin-webhook-sync';

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
  const normalizedManagerId = parseInt(String(managerId), 10);
  const normalizedOrderId = orderId ? parseInt(String(orderId), 10) : null;

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

    const initiatedAt = new Date().toISOString();
    let trackingWarning: string | null = null;

    try {
      await upsertCanonicalTelphinCall({
        callId: callSid,
        direction: 'outgoing',
        fromNumber: `manager:${normalizedManagerId}`,
        toNumber: phoneNumber,
        startedAt: initiatedAt,
        status: 'initiated',
        payload: {
          call_id: callSid,
          status: 'initiated',
          initiated_at: initiatedAt,
          manager_id: normalizedManagerId,
          order_id: normalizedOrderId,
          phone_number: phoneNumber,
          mock: shouldMock,
        },
        syncSource: 'manual_call_initiate',
      });
    } catch (trackingError) {
      trackingWarning = 'canonical_call_tracking_failed';
      console.error('Failed to track initiated call in raw_telphin_calls:', trackingError);
    }

    await bestEffortInsertOutgoingLegacyCall({
      callId: callSid,
      orderId: normalizedOrderId,
      managerId: normalizedManagerId,
      phoneNumber,
      status: 'initiated',
      createdAt: initiatedAt,
    });

    return NextResponse.json({
      success: true,
      callSid,
      status: shouldMock ? 'mock_initiated' : 'initiated',
      timestamp: new Date().toISOString(),
      mock: shouldMock,
      mockReason,
      trackingWarning,
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
