'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OKK_CONSULTANT_QUICK_QUESTIONS } from '@/lib/okk-consultant';
import { useAuth } from '@/components/auth/AuthProvider';

type PanelOrder = {
    order_id: number;
    manager_name?: string | null;
    status_label?: string | null;
    deal_score_pct?: number | null;
    script_score_pct?: number | null;
    total_score?: number | null;
};

type ChatMessage = {
    id: string;
    role: 'user' | 'agent' | 'system';
    text: string;
    createdAt: string;
    metadata?: {
        cards?: ChatCard[];
        responseMode?: 'short' | 'full';
    } | null;
};

type ChatCard = {
    type: 'score' | 'criterion' | 'source' | 'warning' | 'recommendation';
    title: string;
    lines: string[];
    accent?: 'emerald' | 'sky' | 'amber' | 'rose' | 'slate';
};

type ConsultantAskEventDetail = {
    orderId: number | null;
    prompt: string;
};

type ThreadSummary = {
    id: string;
    branch_key: string;
    title?: string | null;
    updated_at?: string;
    created_at?: string;
    order_id?: number | null;
};

function buildIntroMessage(order: PanelOrder | null): ChatMessage {
    if (!order) {
        return {
            id: 'intro-global',
            role: 'system',
            text: 'Семён на связи. Выберите заказ в таблице, и я объясню рейтинг, крестики, галочки, источники данных и что нужно исправить.',
            createdAt: new Date().toISOString(),
        };
    }

    return {
        id: `intro-${order.order_id}`,
        role: 'system',
        text: `Заказ #${order.order_id} выбран. Статус: ${order.status_label || '—'}. Deal: ${order.deal_score_pct ?? '—'}%. Script: ${order.script_score_pct ?? '—'}%. Итог: ${order.total_score ?? '—'}%.`,
        createdAt: new Date().toISOString(),
    };
}

function formatTime(value: string): string {
    return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function getCardTone(accent?: ChatCard['accent']): string {
    if (accent === 'emerald') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-50';
    if (accent === 'sky') return 'border-sky-500/30 bg-sky-500/10 text-sky-50';
    if (accent === 'amber') return 'border-amber-500/30 bg-amber-500/10 text-amber-50';
    if (accent === 'rose') return 'border-rose-500/30 bg-rose-500/10 text-rose-50';
    return 'border-slate-700 bg-slate-900/50 text-slate-100';
}

export default function OKKConsultantPanel({ selectedOrder }: { selectedOrder: PanelOrder | null }) {
    const { user } = useAuth();
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [threadId, setThreadId] = useState<string | null>(null);
    const [activeThreadIds, setActiveThreadIds] = useState<Record<string, string | null>>({});
    const [availableThreads, setAvailableThreads] = useState<Record<string, ThreadSummary[]>>({});
    const [responseMode, setResponseMode] = useState<'short' | 'full'>('full');
    const [queuedAction, setQueuedAction] = useState<ConsultantAskEventDetail | null>(null);
    const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({
        global: [buildIntroMessage(null)],
    });
    const messagesEndRef = useRef<HTMLDivElement | null>(null);

    const threadKey = selectedOrder ? `order-${selectedOrder.order_id}` : 'global';
    const currentContextThreadId = activeThreadIds[threadKey] || null;
    const messages = threads[threadKey] || [];
    const branchOptions = availableThreads[threadKey] || [];
    const quickQuestions = useMemo(() => {
        const baseQuestions = selectedOrder ? [...OKK_CONSULTANT_QUICK_QUESTIONS.order] : [...OKK_CONSULTANT_QUICK_QUESTIONS.global];

        if (user?.role === 'manager') {
            return baseQuestions.filter((question) => !question.toLowerCase().includes('технический разбор'));
        }

        return baseQuestions;
    }, [selectedOrder, user?.role]);

    useEffect(() => {
        setThreads((prev) => {
            if (prev[threadKey]) return prev;
            return {
                ...prev,
                [threadKey]: [buildIntroMessage(selectedOrder)],
            };
        });
    }, [threadKey, selectedOrder]);

    useEffect(() => {
        let aborted = false;

        const loadHistory = async () => {
            try {
                const params = new URLSearchParams();
                if (selectedOrder?.order_id) params.set('orderId', String(selectedOrder.order_id));
                if (currentContextThreadId) params.set('threadId', currentContextThreadId);
                const query = params.toString() ? `?${params.toString()}` : '';
                const res = await fetch(`/api/okk/consultant/history${query}`);
                const data = await res.json();
                if (!res.ok || aborted) return;

                setThreadId(data.thread?.id || null);
                setActiveThreadIds((prev) => ({ ...prev, [threadKey]: data.thread?.id || null }));
                setAvailableThreads((prev) => ({
                    ...prev,
                    [threadKey]: Array.isArray(data.threads) ? data.threads : [],
                }));
                setThreads((prev) => ({
                    ...prev,
                    [threadKey]: Array.isArray(data.messages) && data.messages.length > 0
                        ? data.messages.map((item: any) => ({
                            ...item,
                            metadata: item.metadata || null,
                        }))
                        : [buildIntroMessage(selectedOrder)],
                }));
            } catch {
                if (!aborted) {
                    setAvailableThreads((prev) => ({ ...prev, [threadKey]: prev[threadKey] || [] }));
                    setThreads((prev) => ({
                        ...prev,
                        [threadKey]: prev[threadKey] || [buildIntroMessage(selectedOrder)],
                    }));
                }
            }
        };

        loadHistory();
        return () => {
            aborted = true;
        };
    }, [currentContextThreadId, selectedOrder, threadKey]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);

    const orderBadge = useMemo(() => {
        if (!selectedOrder) return 'Контекст: общий';
        return `Заказ #${selectedOrder.order_id}`;
    }, [selectedOrder]);

    const pushMessage = useCallback((message: ChatMessage) => {
        setThreads((prev) => ({
            ...prev,
            [threadKey]: [...(prev[threadKey] || []), message],
        }));
    }, [threadKey]);

    const clearThread = () => {
        const run = async () => {
            try {
                const res = await fetch('/api/okk/consultant/history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'reset', orderId: selectedOrder?.order_id ?? null, threadId }),
                });
                const data = await res.json();
                setThreadId(data.thread?.id || null);
                setActiveThreadIds((prev) => ({ ...prev, [threadKey]: data.thread?.id || null }));
                setAvailableThreads((prev) => ({
                    ...prev,
                    [threadKey]: Array.isArray(data.threads) ? data.threads : prev[threadKey] || [],
                }));
            } catch {
                setThreadId(null);
                setActiveThreadIds((prev) => ({ ...prev, [threadKey]: null }));
            } finally {
                setThreads((prev) => ({
                    ...prev,
                    [threadKey]: [buildIntroMessage(selectedOrder)],
                }));
            }
        };

        void run();
    };

    const createBranch = () => {
        const run = async () => {
            try {
                const titleBase = selectedOrder ? `Разбор #${selectedOrder.order_id}` : 'Новая тема ОКК';
                const res = await fetch('/api/okk/consultant/history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'create_branch', orderId: selectedOrder?.order_id ?? null, title: titleBase }),
                });
                const data = await res.json();
                if (!res.ok) return;

                setThreadId(data.thread?.id || null);
                setActiveThreadIds((prev) => ({ ...prev, [threadKey]: data.thread?.id || null }));
                setAvailableThreads((prev) => ({
                    ...prev,
                    [threadKey]: Array.isArray(data.threads) ? data.threads : prev[threadKey] || [],
                }));
                setThreads((prev) => ({
                    ...prev,
                    [threadKey]: [buildIntroMessage(selectedOrder)],
                }));
            } catch {
                // noop
            }
        };

        void run();
    };

    const ask = useCallback(async (question: string) => {
        if (!question.trim() || loading) return;

        const userMessage: ChatMessage = {
            id: `${threadKey}-user-${Date.now()}`,
            role: 'user',
            text: question,
            createdAt: new Date().toISOString(),
        };

        pushMessage(userMessage);
        setLoading(true);
        setInput('');

        try {
            const history = (threads[threadKey] || []).slice(-8).map((item) => ({
                role: item.role,
                text: item.text,
            }));

            const res = await fetch('/api/okk/consultant', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: question,
                    orderId: selectedOrder?.order_id ?? null,
                    threadId,
                    history,
                    responseMode,
                }),
            });
            const data = await res.json();

            if (data.threadId) {
                setThreadId(data.threadId);
            }

            pushMessage({
                id: `${threadKey}-agent-${Date.now()}`,
                role: 'agent',
                text: data.reply || data.error || 'Не удалось получить ответ.',
                createdAt: new Date().toISOString(),
                metadata: {
                    cards: Array.isArray(data.cards) ? data.cards : [],
                    responseMode: data.responseMode === 'short' ? 'short' : 'full',
                },
            });
        } catch (error) {
            pushMessage({
                id: `${threadKey}-error-${Date.now()}`,
                role: 'agent',
                text: 'Связь с консультантом не удалась. Повторите запрос.',
                createdAt: new Date().toISOString(),
            });
        } finally {
            setLoading(false);
        }
    }, [loading, pushMessage, responseMode, selectedOrder?.order_id, threadId, threadKey, threads]);

    useEffect(() => {
        if (!queuedAction) return;
        const selectedOrderId = selectedOrder?.order_id ?? null;
        if (queuedAction.orderId !== selectedOrderId || loading) return;
        void ask(queuedAction.prompt);
        setQueuedAction(null);
    }, [ask, loading, queuedAction, selectedOrder]);

    useEffect(() => {
        const handleQuickAsk = (event: Event) => {
            const customEvent = event as CustomEvent<ConsultantAskEventDetail>;
            const detail = customEvent.detail;
            if (!detail?.prompt) return;

            if ((detail.orderId ?? null) !== (selectedOrder?.order_id ?? null)) {
                setQueuedAction(detail);
                return;
            }

            void ask(detail.prompt);
        };

        window.addEventListener('okk-consultant-ask', handleQuickAsk);
        return () => window.removeEventListener('okk-consultant-ask', handleQuickAsk);
    }, [ask, selectedOrder]);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        await ask(input);
    };

    const panelContent = (
        <>
            <div className="border-b border-slate-800 bg-[#111b21] px-3 py-3">
                <div className="flex items-start gap-2.5">
                    <img src="/images/agents/semen.png" alt="Семён" className="h-10 w-10 rounded-full border border-emerald-400/30 object-cover shadow-lg shadow-emerald-500/10" />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-sm font-black text-white">Семён</div>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={clearThread}
                                    className="rounded-full border border-slate-700 bg-slate-900/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
                                >
                                    Новая тема
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setMobileOpen(false)}
                                    className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-700 bg-slate-900/60 text-slate-300 md:hidden"
                                    aria-label="Закрыть консультанта"
                                >
                                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <div className="text-[11px] font-medium text-emerald-400">Консультант ОКК</div>
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400">
                            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                            онлайн
                        </div>
                    </div>
                </div>

                <div className="mt-3 grid gap-1 rounded-2xl border border-slate-800 bg-[#0b141a] px-3 py-2 text-[10px] text-slate-400">
                    <div className="flex items-center justify-between gap-2">
                        <span>{orderBadge}</span>
                        <span>{responseMode === 'short' ? 'коротко' : 'полно'}</span>
                    </div>
                    {selectedOrder ? (
                        <>
                            <div className="truncate">МОП: {selectedOrder.manager_name || '—'}</div>
                            <div className="truncate">Статус: {selectedOrder.status_label || '—'}</div>
                        </>
                    ) : (
                        <div>Память: заказ не выбран</div>
                    )}
                    <div className="mt-1 flex gap-1">
                        <button
                            type="button"
                            onClick={() => setResponseMode('short')}
                            className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide transition-colors ${responseMode === 'short' ? 'bg-emerald-500 text-white' : 'bg-slate-900/70 text-slate-400 hover:text-white'}`}
                        >
                            short
                        </button>
                        <button
                            type="button"
                            onClick={() => setResponseMode('full')}
                            className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide transition-colors ${responseMode === 'full' ? 'bg-emerald-500 text-white' : 'bg-slate-900/70 text-slate-400 hover:text-white'}`}
                        >
                            full
                        </button>
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                        <select
                            value={threadId || ''}
                            onChange={(event) => {
                                const nextThreadId = event.target.value || null;
                                setThreadId(nextThreadId);
                                setActiveThreadIds((prev) => ({ ...prev, [threadKey]: nextThreadId }));
                            }}
                            className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950/70 px-2 py-1 text-[10px] text-slate-200 outline-none"
                        >
                            {branchOptions.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.title || item.branch_key}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={createBranch}
                            className="rounded-full border border-slate-700 bg-slate-900/60 px-2 py-1 text-[10px] font-black text-slate-200 hover:border-emerald-500/40"
                            aria-label="Новая ветка"
                        >
                            +
                        </button>
                    </div>
                </div>
            </div>

            <div
                className="min-h-0 flex-1 overflow-auto bg-[#0b141a] bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.08),transparent_35%),linear-gradient(180deg,#0b141a_0%,#0a1015_100%)] px-2 py-3 overscroll-contain"
            >
                <div className="mb-3 rounded-2xl bg-[#202c33] px-3 py-3 text-[11px] leading-relaxed text-slate-300 shadow-sm">
                    Задавайте вопросы по текущему заказу. Я объясню, как считается рейтинг, почему стоит крестик, откуда взялись данные и что нужно исправить.
                </div>

                <div className="mb-3 flex flex-wrap gap-1.5">
                    {quickQuestions.map((question) => (
                        <button
                            key={question}
                            type="button"
                            onClick={() => void ask(question)}
                            className="rounded-full border border-slate-700 bg-[#111b21] px-2.5 py-1 text-[10px] font-semibold text-slate-200 transition-colors hover:border-emerald-500/40 hover:bg-[#16252d]"
                        >
                            {question}
                        </button>
                    ))}
                </div>

                <div className="space-y-2.5">
                    {messages.map((message) => {
                        const isUser = message.role === 'user';
                        const isSystem = message.role === 'system';
                        return (
                            <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                                <div
                                    className={`max-w-[92%] rounded-2xl px-3 py-2 text-[11px] leading-relaxed shadow-md ${
                                        isUser
                                            ? 'rounded-br-md bg-[#005c4b] text-white'
                                            : isSystem
                                                ? 'rounded-bl-md border border-slate-700 bg-[#202c33] text-slate-300'
                                                : 'rounded-bl-md bg-[#111b21] text-slate-100'
                                    }`}
                                >
                                    <div className="whitespace-pre-wrap break-words">{message.text}</div>
                                    {message.role === 'agent' && message.metadata?.cards && message.metadata.cards.length > 0 && (
                                        <div className="mt-2 space-y-2">
                                            {message.metadata.cards.map((card, index) => (
                                                <div key={`${message.id}-card-${index}`} className={`rounded-2xl border px-2.5 py-2 ${getCardTone(card.accent)}`}>
                                                    <div className="text-[10px] font-black uppercase tracking-wide">{card.title}</div>
                                                    <div className="mt-1 space-y-1">
                                                        {card.lines.map((line, lineIndex) => (
                                                            <div key={`${message.id}-card-${index}-line-${lineIndex}`} className="text-[10px] leading-relaxed text-current/90">
                                                                {line}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div className={`mt-1 text-right text-[9px] ${isUser ? 'text-emerald-100/70' : 'text-slate-400'}`}>
                                        {formatTime(message.createdAt)}
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {loading && (
                        <div className="flex justify-start">
                            <div className="rounded-2xl rounded-bl-md bg-[#111b21] px-3 py-2 text-[11px] text-slate-300 shadow-md">
                                Семён собирает доказательства...
                            </div>
                        </div>
                    )}
                </div>

                <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSubmit} className="border-t border-slate-800 bg-[#111b21] px-2 py-2">
                <div className="mb-2 rounded-2xl border border-slate-800 bg-[#0b141a] px-3 py-2 text-[10px] text-slate-400">
                    Можно спрашивать: почему крестик, как посчитан балл, откуда данные, что исправить, какие критерии спорные и каких данных не хватает.
                </div>
                <div className="flex items-end gap-2">
                    <textarea
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        rows={3}
                        placeholder={selectedOrder ? 'Вопрос по текущему заказу...' : 'Выберите заказ или задайте общий вопрос...'}
                        className="min-h-[76px] flex-1 resize-none rounded-2xl border border-slate-800 bg-[#0b141a] px-3 py-2 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-500/40"
                    />
                    <button
                        type="submit"
                        disabled={loading || !input.trim()}
                        className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:shadow-none"
                        aria-label="Отправить"
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h12M13 6l6 6-6 6" />
                        </svg>
                    </button>
                </div>
            </form>
        </>
    );

    return (
        <>
            <aside className="hidden h-full min-h-0 shrink-0 flex-col overflow-hidden border border-slate-800/80 bg-[#0f1726] text-slate-100 shadow-[0_18px_40px_rgba(2,6,23,0.24)] md:flex md:w-[clamp(340px,24vw,420px)] md:min-w-[340px] md:rounded-[28px]">
                {panelContent}
            </aside>

            <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="fixed bottom-4 right-4 z-[140] flex items-center gap-2 rounded-full border border-emerald-400/30 bg-[#111b21] px-3 py-2 text-xs font-black text-white shadow-[0_12px_32px_rgba(2,6,23,0.45)] md:hidden"
            >
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                Семён
            </button>

            {mobileOpen && (
                <div className="fixed inset-0 z-[150] md:hidden">
                    <button type="button" aria-label="Закрыть слой" className="absolute inset-0 bg-slate-950/70" onClick={() => setMobileOpen(false)} />
                    <aside className="absolute inset-x-0 bottom-0 top-14 flex flex-col overflow-hidden rounded-t-[28px] border-t border-slate-800/80 bg-[#0f1726] text-slate-100 shadow-[0_-16px_40px_rgba(2,6,23,0.48)]">
                        {panelContent}
                    </aside>
                </div>
            )}
        </>
    );
}