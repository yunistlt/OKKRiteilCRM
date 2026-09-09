'use client';

import { useEffect, useCallback, useState } from 'react';

interface CallEvent {
  type:
    | 'incoming_call'
    | 'call_status_update'
    | 'call_completed'
    | 'call_failed';
  callId: string;
  data?: Record<string, any>;
}

type CallEventListener = (event: CallEvent) => void;

export function useCallNotifications() {
  const [notifications, setNotifications] = useState<CallEvent[]>([]);
  const [listeners, setListeners] = useState<Set<CallEventListener>>(new Set());

  const subscribeToUpdates = useCallback((listener: CallEventListener) => {
    setListeners((prev) => {
      const newSet = new Set(prev);
      newSet.add(listener);
      return newSet;
    });

    // Возвращаем функцию для отписки
    return () => {
      setListeners((prev) => {
        const newSet = new Set(prev);
        newSet.delete(listener);
        return newSet;
      });
    };
  }, []);

  // Подписываемся на SSE обновления
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const eventSource = new EventSource('/api/calls/subscribe');

    eventSource.addEventListener('call_event', (event) => {
      try {
        const callEvent: CallEvent = JSON.parse(event.data);
        console.log('📞 Received call event:', callEvent);

        // Добавляем в историю
        setNotifications((prev) => [callEvent, ...prev].slice(0, 100));

        // Уведомляем всех слушателей
        listeners.forEach((listener) => {
          try {
            listener(callEvent);
          } catch (e) {
            console.error('Error in call event listener:', e);
          }
        });
      } catch (e) {
        console.error('Failed to parse call event:', e);
      }
    });

    eventSource.onerror = () => {
      console.warn('SSE connection error, reconnecting...');
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [listeners]);

  return {
    notifications,
    subscribeToUpdates,
  };
}
