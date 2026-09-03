'use client';

import { useEffect, useState } from 'react';
import { Loader, Send } from 'lucide-react';

interface OrderReplyFormProps {
    orderNumber: string;
    onClose: () => void;
    onSent?: () => void;
}

interface ThreadState {
    to: string | null;
    subjectText: string;
    hasThread: boolean;
    thread: Array<{ from: string | null; fromName: string | null; receivedAt: string | null; preview: string }>;
}

/**
 * Ответ клиенту по заказу. Почта у компании одна, поэтому письмо привязывается к заказу
 * служебным тегом в теме — его добавляет сервер, менеджеру этого видеть не нужно.
 */
export default function OrderReplyForm({ orderNumber, onClose, onSent }: OrderReplyFormProps) {
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    const [to, setTo] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [thread, setThread] = useState<ThreadState | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/orders/${orderNumber}/email-thread`);
                const data = await res.json();
                if (cancelled) return;
                if (!res.ok) throw new Error(data.error || 'Не удалось загрузить переписку');
                setThread(data);
                setTo(data.to || '');
                setSubject(data.subjectText || `По заказу №${orderNumber}`);
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить переписку');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [orderNumber]);

    const send = async () => {
        setError(null);

        if (!to.trim() || !subject.trim() || !body.trim()) {
            setError('Заполните адресата, тему и текст письма.');
            return;
        }

        setSending(true);
        try {
            const html = body
                .split('\n')
                .map((line) => (line.trim() ? `<p>${line.replace(/</g, '&lt;')}</p>` : '<p>&nbsp;</p>'))
                .join('');

            const res = await fetch('/api/orders/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // force: письмо пишет человек, он и решает, сколько раз отвечать по заказу.
                // Защита от двойного клика — блокировка кнопки на время отправки.
                body: JSON.stringify({ orderNumber, to: to.trim(), subjectText: subject.trim(), html, force: true }),
            });

            const data = await res.json();
            if (!res.ok || !data.ok) {
                throw new Error(data.error === 'smtp_not_configured'
                    ? 'Почта не настроена на сервере — письмо не отправлено.'
                    : (data.error || 'Письмо не ушло'));
            }

            setDone(true);
            onSent?.();

            if (data.appendedToSent === false) {
                setError('Письмо клиенту ушло, но копия не легла в «Отправленные» — в переписке RetailCRM его может не быть.');
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Письмо не ушло');
        } finally {
            setSending(false);
        }
    };

    if (loading) {
        return <div className="border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">Загружаем переписку…</div>;
    }

    if (done) {
        return (
            <div className="border border-green-600 bg-green-50 p-4">
                <p className="text-sm font-bold text-green-800">Письмо отправлено на {to}</p>
                {error && <p className="mt-1 text-xs text-amber-800">{error}</p>}
                <button onClick={onClose} className="mt-3 border border-gray-300 px-3 py-1.5 text-xs font-bold hover:bg-gray-900 hover:text-white">
                    Закрыть
                </button>
            </div>
        );
    }

    return (
        <div className="border border-gray-300 bg-gray-50 p-4">
            <div className="mb-3 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                    {thread?.hasThread ? 'Ответ в переписку по заказу' : 'Первое письмо по заказу'}
                </span>
                <button onClick={onClose} className="text-xs font-bold text-gray-500 hover:text-gray-900">Отменить</button>
            </div>

            <div className="space-y-2">
                <div>
                    <label className="mb-1 block text-[10px] font-black uppercase text-gray-400">Кому</label>
                    <input
                        type="email"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        placeholder="client@example.com"
                        className="w-full border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                    />
                </div>

                <div>
                    <label className="mb-1 block text-[10px] font-black uppercase text-gray-400">Тема</label>
                    <input
                        type="text"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        className="w-full border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] text-gray-500">
                        Номер заказа в тему подставится сам — по нему RetailCRM привяжет письмо к заказу.
                    </p>
                </div>

                <div>
                    <label className="mb-1 block text-[10px] font-black uppercase text-gray-400">Текст письма</label>
                    <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        rows={8}
                        placeholder="Здравствуйте!"
                        className="w-full border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
                    />
                </div>
            </div>

            {error && <p className="mt-2 border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</p>}

            <div className="mt-3 flex items-center gap-3">
                <button
                    onClick={send}
                    disabled={sending}
                    className="flex items-center gap-1.5 bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500"
                >
                    {sending ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
                    {sending ? 'Отправляем…' : 'Отправить'}
                </button>
                <span className="text-[11px] text-gray-500">Уйдёт с общего ящика компании rop@zmktlt.ru</span>
            </div>

            {thread?.thread?.length ? (
                <div className="mt-4 border-t border-gray-200 pt-3">
                    <p className="mb-2 text-[10px] font-black uppercase text-gray-400">Что было в переписке</p>
                    <ul className="space-y-2">
                        {thread.thread.map((m, i) => (
                            <li key={i} className="text-xs text-gray-600">
                                <span className="font-bold text-gray-900">{m.fromName || m.from || 'Без адреса'}</span>
                                {m.receivedAt && <span className="ml-2 text-gray-400">{new Date(m.receivedAt).toLocaleString('ru-RU')}</span>}
                                {m.preview && <p className="mt-0.5">{m.preview}</p>}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}
