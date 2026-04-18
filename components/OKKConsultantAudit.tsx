'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type AuditLog = {
    id: string;
    trace_id: string;
    thread_id: string;
    user_id: string;
    username: string;
    order_id: number | null;
    criterion_key: string | null;
    intent: string | null;
    question: string;
    answer_preview: string | null;
    used_fallback: boolean;
    created_at: string;
};

type TraceMessage = {
    id: string;
    role: 'user' | 'agent';
    content: string;
    created_at: string;
    metadata?: Record<string, any> | null;
};

function inferLegacyReplyKind(metadata: Record<string, any> | null | undefined): string | null {
    if (!metadata || typeof metadata !== 'object') return null;
    if (typeof metadata.replyKind === 'string') return metadata.replyKind;
    if (typeof metadata.criterion_key === 'string' && metadata.criterion_key) return 'criterion';
    if (metadata.fallbackPromptKey || metadata.fallbackKnowledgeHits) return 'fallback';

    switch (metadata.intent) {
        case 'source': return 'order-source';
        case 'score': return 'score';
        case 'proof': return 'proof';
        case 'technical': return 'technical';
        case 'fix': return 'fix';
        case 'failures': return 'failures';
        case 'ambiguous': return 'ambiguous';
        case 'missing': return 'missing';
        default: return null;
    }
}

export default function OKKConsultantAudit() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
    const [traceMessages, setTraceMessages] = useState<TraceMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [traceLoading, setTraceLoading] = useState(false);
    const [orderFilter, setOrderFilter] = useState('');
    const [intentFilter, setIntentFilter] = useState('');
    const [error, setError] = useState<string | null>(null);

    const intents = useMemo(() => Array.from(new Set(logs.map((log) => log.intent).filter(Boolean))) as string[], [logs]);
    const selectedLog = useMemo(() => logs.find((log) => log.trace_id === selectedTraceId) || null, [logs, selectedTraceId]);
    const selectedAgentMetadata = useMemo(
        () => [...traceMessages].reverse().find((message) => message.role === 'agent')?.metadata || null,
        [traceMessages],
    );
    const auditReplyKind = useMemo(
        () => inferLegacyReplyKind(selectedAgentMetadata),
        [selectedAgentMetadata],
    );
    const auditRoutingKind = useMemo(() => {
        if (typeof selectedAgentMetadata?.routingKind === 'string') return selectedAgentMetadata.routingKind;
        return auditReplyKind;
    }, [auditReplyKind, selectedAgentMetadata]);

    async function loadLogs(traceId?: string | null) {
        const params = new URLSearchParams();
        if (orderFilter.trim()) params.set('orderId', orderFilter.trim());
        if (intentFilter.trim()) params.set('intent', intentFilter.trim());
        if (traceId) params.set('traceId', traceId);

        const response = await fetch(`/api/okk/consultant/logs?${params.toString()}`, { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить логи');

        setLogs(payload.logs || []);
        if (payload.trace) {
            setTraceMessages(payload.trace.messages || []);
            setSelectedTraceId(payload.trace.log?.trace_id || traceId || null);
        } else if (!traceId) {
            setTraceMessages([]);
            setSelectedTraceId((current) => current && (payload.logs || []).some((log: AuditLog) => log.trace_id === current) ? current : null);
        }
    }

    useEffect(() => {
        setLoading(true);
        setError(null);
        loadLogs().catch((err) => setError(err.message)).finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (!selectedTraceId) return;
        setTraceLoading(true);
        setError(null);
        loadLogs(selectedTraceId).catch((err) => setError(err.message)).finally(() => setTraceLoading(false));
    }, [selectedTraceId]);

    async function applyFilters() {
        setLoading(true);
        setError(null);
        try {
            await loadLogs();
        } catch (err: any) {
            setError(err.message || 'Не удалось обновить аудит');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex min-h-full flex-col bg-[#f4f1eb]">
            <div className="border-b border-stone-200 bg-white/90 px-4 py-3 backdrop-blur md:px-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                        <Link href="/okk" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-stone-50 text-stone-500 transition-colors hover:bg-stone-100">
                            ←
                        </Link>
                        <div>
                            <h1 className="text-lg font-black text-stone-900">Аудит консультанта ОКК</h1>
                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Trace-id, intent, fallback и история ответа</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            value={orderFilter}
                            onChange={(e) => setOrderFilter(e.target.value)}
                            placeholder="order_id"
                            className="h-10 rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-800 outline-none transition-colors focus:border-emerald-400"
                        />
                        <select
                            value={intentFilter}
                            onChange={(e) => setIntentFilter(e.target.value)}
                            className="h-10 rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-800 outline-none transition-colors focus:border-emerald-400"
                        >
                            <option value="">Все intents</option>
                            {intents.map((intent) => (
                                <option key={intent} value={intent}>{intent}</option>
                            ))}
                        </select>
                        <button
                            onClick={applyFilters}
                            className="h-10 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white transition-colors hover:bg-emerald-700"
                        >
                            Обновить
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-stone-200 lg:grid-cols-[420px_minmax(0,1fr)]">
                <aside className="min-h-0 bg-[#efeae2]">
                    <div className="border-b border-stone-200 bg-[#d9fdd3] px-4 py-3 text-xs font-bold uppercase tracking-[0.2em] text-emerald-900">
                        Последние trace
                    </div>
                    <div className="max-h-[calc(100dvh-170px)] overflow-y-auto">
                        {loading ? (
                            <div className="p-6 text-sm text-stone-500">Загрузка логов...</div>
                        ) : logs.length === 0 ? (
                            <div className="p-6 text-sm text-stone-500">Логи не найдены по текущему фильтру.</div>
                        ) : logs.map((log) => (
                            <button
                                key={log.id}
                                onClick={() => setSelectedTraceId(log.trace_id)}
                                className={`block w-full border-b border-stone-200 px-4 py-3 text-left transition-colors ${selectedTraceId === log.trace_id ? 'bg-white' : 'bg-[#efeae2] hover:bg-[#e7dfd5]'}`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-black text-stone-900">{log.question}</div>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-stone-500">
                                            <span>{new Date(log.created_at).toLocaleString('ru-RU')}</span>
                                            <span>trace {log.trace_id.slice(0, 8)}</span>
                                            {log.order_id && <span>заказ #{log.order_id}</span>}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-1">
                                        <span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-stone-600">{log.intent || 'general'}</span>
                                        {log.used_fallback && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">fallback</span>}
                                    </div>
                                </div>
                                <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-stone-600">{log.answer_preview || 'Ответ не сохранён'}</div>
                            </button>
                        ))}
                    </div>
                </aside>

                <section className="min-h-0 bg-[#efeae2]">
                    <div className="border-b border-stone-200 bg-[#f0f2f5] px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-black text-stone-900">{selectedLog ? `Разбор trace ${selectedLog.trace_id}` : 'Выберите trace слева'}</div>
                                <div className="text-xs text-stone-500">{selectedLog ? `Пользователь ${selectedLog.username}, intent ${selectedLog.intent || 'general'}` : 'Доступны полный вопрос, preview ответа и сообщения текущего trace.'}</div>
                            </div>
                            {selectedLog?.order_id && (
                                <Link href={`/okk?orderId=${selectedLog.order_id}`} className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-bold text-stone-700 transition-colors hover:bg-stone-50">
                                    К заказу #{selectedLog.order_id}
                                </Link>
                            )}
                        </div>
                    </div>

                    <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                        <div className="max-h-[calc(100dvh-170px)] overflow-y-auto bg-[#e5ddd5] p-4">
                            {error && <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
                            {!selectedLog ? (
                                <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-stone-500">Выберите запись аудита, чтобы увидеть trace.</div>
                            ) : traceLoading ? (
                                <div className="text-sm text-stone-500">Загрузка trace...</div>
                            ) : (
                                <div className="space-y-4">
                                    {traceMessages.length > 0 ? traceMessages.map((message) => (
                                        <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${message.role === 'user' ? 'bg-[#d9fdd3] text-stone-900' : 'bg-white text-stone-800'}`}>
                                                <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
                                                <div className="mt-2 text-[11px] font-semibold text-stone-400">{new Date(message.created_at).toLocaleString('ru-RU')}</div>
                                            </div>
                                        </div>
                                    )) : (
                                        <div className="rounded-2xl bg-white px-4 py-3 text-sm text-stone-500 shadow-sm">По этому trace в истории треда не найдено отдельных сообщений. Остаётся preview из аудита.</div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="max-h-[calc(100dvh-170px)] overflow-y-auto border-l border-stone-200 bg-white p-4">
                            {selectedLog ? (
                                <div className="space-y-4">
                                    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                                        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-stone-500">Question</div>
                                        <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-800">{selectedLog.question}</div>
                                    </div>
                                    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                                        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-stone-500">Answer Preview</div>
                                        <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-800">{selectedLog.answer_preview || 'Нет preview'}</div>
                                    </div>
                                    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
                                        <div className="grid gap-2">
                                            <div><span className="font-black text-stone-900">trace_id:</span> {selectedLog.trace_id}</div>
                                            <div><span className="font-black text-stone-900">thread_id:</span> {selectedLog.thread_id}</div>
                                            <div><span className="font-black text-stone-900">criterion:</span> {selectedLog.criterion_key || '—'}</div>
                                            <div><span className="font-black text-stone-900">routing:</span> {auditRoutingKind || '—'}</div>
                                            <div><span className="font-black text-stone-900">reply_kind:</span> {auditReplyKind || '—'}</div>
                                            <div><span className="font-black text-stone-900">fallback:</span> {selectedLog.used_fallback ? 'да' : 'нет'}</div>
                                            <div><span className="font-black text-stone-900">created_at:</span> {new Date(selectedLog.created_at).toLocaleString('ru-RU')}</div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-sm text-stone-500">Справа появятся детали выбранного trace.</div>
                            )}
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}