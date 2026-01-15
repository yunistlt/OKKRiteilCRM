'use client';

import { useState, useEffect } from 'react';

interface OrderDetailsModalProps {
    orderId: number;
    isOpen: boolean;
    onClose: () => void;
}

interface OrderDetails {
    order: any;
    calls: any[];
    raw_payload: any;
}

export default function OrderDetailsModal({ orderId, isOpen, onClose }: OrderDetailsModalProps) {
    const [data, setData] = useState<OrderDetails | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen && orderId) {
            fetchDetails();
        }
    }, [isOpen, orderId]);

    const fetchDetails = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/orders/${orderId}/details`);
            const json = await res.json();
            if (json.error) throw new Error(json.error);
            setData(json);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                    <div>
                        <h2 className="text-lg font-bold text-gray-800">
                            Детали заказа #{orderId}
                        </h2>
                        {data?.order && (
                            <div className="text-xs text-gray-500 mt-1 flex gap-3">
                                <span>Менеджер: <strong>{data.order.manager_name}</strong></span>
                                <span>Сумма: <strong>{data.order.totalsumm?.toLocaleString()} ₽</strong></span>
                                <span>Статус: <strong>{data.order.status}</strong></span>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-200 rounded-full text-gray-500 transition-colors"
                    >
                        ✕
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-8">
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        </div>
                    ) : error ? (
                        <div className="p-4 bg-red-50 text-red-600 rounded-lg">
                            Ошибка загрузки: {error}
                        </div>
                    ) : data ? (
                        <>
                            {/* 1. Transcriptions / Calls */}
                            <section>
                                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 border-b pb-2">
                                    📞 Звонки и Транскрибация
                                </h3>
                                {data.calls.length === 0 ? (
                                    <p className="text-sm text-gray-500 italic">Звонков по заказу не найдено.</p>
                                ) : (
                                    <div className="space-y-4">
                                        {data.calls.map((call: any) => (
                                            <div key={call.id} className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                                                <div className="flex justify-between items-start mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`px-2 py-0.5 text-[10px] rounded uppercase font-bold ${call.type === 'incoming'
                                                                ? 'bg-green-100 text-green-700'
                                                                : 'bg-blue-100 text-blue-700'
                                                            }`}>
                                                            {call.type === 'incoming' ? 'Входящий' : 'Исходящий'}
                                                        </span>
                                                        <span className="text-xs text-gray-500">
                                                            {new Date(call.date).toLocaleString('ru-RU')}
                                                        </span>
                                                        <span className="text-xs text-gray-400">
                                                            ({Math.floor(call.duration / 60)}м {call.duration % 60}с)
                                                        </span>
                                                    </div>
                                                    {call.link && (
                                                        <a
                                                            href={call.link}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                                                        >
                                                            🎧 Запись
                                                        </a>
                                                    )}
                                                </div>

                                                {call.summary ? (
                                                    <div className="mb-3 p-3 bg-white rounded border border-purple-100 text-sm text-gray-800">
                                                        <strong className="text-purple-700 text-xs block mb-1">AI Summary:</strong>
                                                        {call.summary}
                                                    </div>
                                                ) : null}

                                                {call.transcription ? (
                                                    <div className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed font-mono bg-white p-3 rounded border">
                                                        {call.transcription}
                                                    </div>
                                                ) : (
                                                    <div className="text-xs text-gray-400 italic">
                                                        Транскрибация отсутствует...
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>

                            {/* 2. Manager Comments (RetailCRM Context) */}
                            <section>
                                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 border-b pb-2">
                                    💬 Комментарии Менеджера
                                </h3>
                                {data.raw_payload?.managerComment ? (
                                    <div className="p-4 bg-yellow-50 border border-yellow-100 rounded-lg text-sm text-gray-800">
                                        {data.raw_payload.managerComment}
                                    </div>
                                ) : (
                                    <p className="text-sm text-gray-500 italic">Комментариев нет.</p>
                                )}
                            </section>

                            {/* 3. Customer Info */}
                            <section>
                                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 border-b pb-2">
                                    👤 Клиент
                                </h3>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div className="p-3 bg-gray-50 rounded">
                                        <span className="text-gray-500 text-xs block">Имя</span>
                                        <span className="font-medium text-gray-900">
                                            {data.raw_payload?.firstName} {data.raw_payload?.lastName}
                                        </span>
                                    </div>
                                    <div className="p-3 bg-gray-50 rounded">
                                        <span className="text-gray-500 text-xs block">Телефон</span>
                                        <span className="font-medium text-gray-900 font-mono">
                                            {data.raw_payload?.phone}
                                        </span>
                                    </div>
                                    <div className="p-3 bg-gray-50 rounded col-span-2">
                                        <span className="text-gray-500 text-xs block">Адрес / Доставка</span>
                                        <span className="font-medium text-gray-900">
                                            {data.raw_payload?.delivery?.address?.text || 'Не указан'}
                                        </span>
                                    </div>
                                </div>
                            </section>
                        </>
                    ) : null}
                </div>

                {/* Footer */}
                <div className="p-4 border-t bg-gray-50 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors shadow-sm text-sm font-medium"
                    >
                        Закрыть
                    </button>
                </div>
            </div>
        </div>
    );
}
