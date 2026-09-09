'use client';

import { useEffect, useState } from 'react';
import { PhoneIncoming, PhoneOutgoing } from 'lucide-react';

interface CallHistoryItem {
  id: number;
  direction: 'incoming' | 'outgoing';
  contactPhone: string;
  duration?: number | null;
  createdAt: string;
  status: string;
}

const STATUS_LABELS: Record<string, string> = {
  initiated: 'Набор',
  ringing: 'Дозвон',
  connected: 'Разговор',
  completed: 'Состоялся',
  failed: 'Не дозвонились',
  missed: 'Пропущен',
  busy: 'Занято',
  no_answer: 'Без ответа',
  cancelled: 'Отменён',
};

export function CallHistory() {
  const [calls, setCalls] = useState<CallHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchCalls = async () => {
      try {
        const response = await fetch('/api/calls/history?limit=25');
        const data = await response.json();
        if (!cancelled && data.success) {
          setCalls(data.calls);
        }
      } catch (error) {
        console.error('Не удалось загрузить историю звонков:', error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchCalls();
    const interval = setInterval(fetchCalls, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div>
      <div className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">
        Последние звонки
      </div>

      {isLoading ? (
        <p className="px-3 py-4 text-xs text-gray-500">Загружаем историю…</p>
      ) : calls.length === 0 ? (
        <p className="px-3 py-4 text-xs text-gray-500">Звонков пока нет.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {calls.map((call) => (
            <li key={`${call.direction}-${call.id}`} className="flex items-center gap-2 px-3 py-2">
              <span className={call.direction === 'incoming' ? 'text-green-600' : 'text-blue-600'}>
                {call.direction === 'incoming' ? (
                  <PhoneIncoming size={14} />
                ) : (
                  <PhoneOutgoing size={14} />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs font-bold text-gray-900">
                  {call.contactPhone}
                </div>
                <div className="text-[10px] text-gray-500">
                  {formatTime(call.createdAt)} · {STATUS_LABELS[call.status] || call.status}
                </div>
              </div>

              <span className="font-mono text-xs text-gray-600">
                {formatDuration(call.duration)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
