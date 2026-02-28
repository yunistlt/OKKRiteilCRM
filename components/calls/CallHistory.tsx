'use client';

import { useEffect, useState } from 'react';
import { Phone, PhoneIncoming, PhoneOutgoing, Clock, Music } from 'lucide-react';
import { supabase } from '@/utils/supabase';

interface CallRecord {
  id: string;
  direction: 'incoming' | 'outgoing';
  contact: string;
  status: string;
  duration_seconds?: number;
  created_at: string;
  recording_url?: string;
}

interface CallHistoryProps {
  orderId: string;
  limit?: number;
}

export default function CallHistory({ orderId, limit = 10 }: CallHistoryProps) {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchCallHistory();
  }, [orderId]);

  const fetchCallHistory = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('call_timeline')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      setCalls(data || []);
    } catch (error) {
      console.error('Failed to fetch call history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('ru-RU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return <div className="text-gray-500">Загрузка истории звонков...</div>;
  }

  if (calls.length === 0) {
    return <div className="text-gray-400 text-sm">Звонков не было</div>;
  }

  return (
    <div className="space-y-2">
      {calls.map((call) => (
        <div
          key={call.id}
          className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition"
        >
          <div className="flex items-center gap-3 flex-1">
            <div className={`p-2 rounded-full ${
              call.direction === 'incoming'
                ? 'bg-green-100'
                : 'bg-blue-100'
            }`}>
              {call.direction === 'incoming' ? (
                <PhoneIncoming className="w-4 h-4 text-green-600" />
              ) : (
                <PhoneOutgoing className="w-4 h-4 text-blue-600" />
              )}
            </div>

            <div className="flex-1">
              <div className="font-medium text-sm">{call.contact}</div>
              <div className="text-xs text-gray-500 flex items-center gap-2">
                <Clock className="w-3 h-3" />
                {formatDate(call.created_at)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-right">
            <div>
              <div className="text-sm font-medium text-gray-700">
                {formatDuration(call.duration_seconds)}
              </div>
              <div className="text-xs text-gray-500">
                {call.status === 'completed' ? '✓ Завершён' : call.status}
              </div>
            </div>

            {call.recording_url && (
              <a
                href={call.recording_url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 text-orange-600 hover:bg-orange-50 rounded transition"
                title="Скачать запись"
              >
                <Music className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
