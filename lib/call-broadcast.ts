// Map для отслеживания активных SSE соединений
let activeConnections = new Map<
  string,
  {
    controller: ReadableStreamDefaultController<Uint8Array>;
    closed: boolean;
  }
>();

// Регистрируем новое SSE соединение
export function registerSSEConnection(
  connectionId: string,
  controller: ReadableStreamDefaultController<Uint8Array>
) {
  activeConnections.set(connectionId, {
    controller,
    closed: false,
  });
}

// Помечаем соединение как закрытое
export function closeSSEConnection(connectionId: string) {
  const connection = activeConnections.get(connectionId);
  if (connection) {
    connection.closed = true;
    activeConnections.delete(connectionId);
  }
}

// Отправляем событие всем подписчикам
export function broadcastCallEvent(event: {
  type: string;
  callId: string;
  data?: Record<string, any>;
}) {
  const message = `data: ${JSON.stringify(event)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(message);

  activeConnections.forEach((connection, key) => {
    if (!connection.closed) {
      try {
        connection.controller.enqueue(encoded);
      } catch (error) {
        console.error(`Failed to send to connection ${key}:`, error);
        activeConnections.delete(key);
      }
    }
  });
}
