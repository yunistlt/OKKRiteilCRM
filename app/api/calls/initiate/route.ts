import { NextRequest, NextResponse } from 'next/server';
import { bestEffortInsertOutgoingLegacyCall } from '@/lib/telphin-legacy-compat';
import { upsertCanonicalTelphinCall } from '@/lib/telphin-webhook-sync';
import { initiateManagerOutgoingCall } from '@/lib/telphin';
import { broadcastCallEvent } from '@/lib/call-broadcast';

export const dynamic = 'force-dynamic';

// TELPHIN_MOCK_MODE здесь СОЗНАТЕЛЬНО не читается: менеджер нажал «Позвонить» —
// значит хочет реального звонка. Так же поступает воркер обратного звонка.
// Демо-режим остаётся только там, где звонить физически нечем — нет ключей.
const hasTelphinCredentials = Boolean(
  (process.env.TELPHIN_APP_KEY || process.env.TELPHIN_CLIENT_ID) &&
  (process.env.TELPHIN_APP_SECRET || process.env.TELPHIN_CLIENT_SECRET)
);
const shouldMock = !hasTelphinCredentials;
const mockReason = shouldMock
  ? 'Ключи Телфина не заданы — звонок не совершается, включён демо-режим'
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
      const result = await initiateManagerOutgoingCall({
        managerId: normalizedManagerId,
        targetPhone: phoneNumber,
      });

      callSid = result.callId;
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

    broadcastCallEvent({
      type: 'call_initiated',
      callId: callSid,
      data: {
        phone: phoneNumber,
        order_id: normalizedOrderId,
        manager_id: normalizedManagerId,
        status: 'initiated',
        mock: shouldMock,
      },
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
