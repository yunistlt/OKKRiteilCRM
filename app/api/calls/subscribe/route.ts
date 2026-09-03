import { NextRequest, NextResponse } from 'next/server';
import { registerSSEConnection, closeSSEConnection } from '@/lib/call-broadcast';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 минут для SSE

export async function GET(req: NextRequest) {
  const connectionId = `${Date.now()}-${Math.random()}`;

  // Создаем ReadableStream для SSE
  const stream = new ReadableStream({
    start(controller) {
      // Регистрируем соединение
      registerSSEConnection(connectionId, controller);

      // Отправляем initial message
      const initialMessage = `data: ${JSON.stringify({
        type: 'connection_established',
        connectionId,
      })}\n\n`;
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(initialMessage));

      console.log(`SSE connection established: ${connectionId}`);
    },
    cancel() {
      closeSSEConnection(connectionId);
      console.log(`SSE connection closed: ${connectionId}`);
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
