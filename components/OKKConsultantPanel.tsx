'use client';

import { FormEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getConsultantSectionByPath } from '@/lib/okk-consultant';

const DESKTOP_WIDTH_STORAGE_KEY = 'okk_consultant_desktop_width';
const DEFAULT_DESKTOP_WIDTH_RATIO = 0.15;
const MIN_DESKTOP_WIDTH = 180;
const MAX_DESKTOP_WIDTH_RATIO = 0.45;

export type PanelOrder = {
    order_id: number;
    manager_name?: string | null;
    status_label?: string | null;
    deal_score_pct?: number | null;
    script_score_pct?: number | null;
    total_score?: number | null;
    sectionData?: Record<string, any> | null;
};

type ChatMessage = {
    id: string;
    role: 'user' | 'agent' | 'system';
    text: string;
    createdAt: string;
    metadata?: {
        responseMode?: 'short' | 'full';
    } | null;
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

function formatTime(value: string): string {
    return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatThreadTitle(thread: ThreadSummary): string {
    if (thread.order_id) return `Чат по заказу #${thread.order_id}`;
    return thread.title?.replace(/^(Общий контекст|Общий чат):\s*/i, '') || 'Общий чат';
}

function clampDesktopWidth(width: number): number {
    if (typeof window === 'undefined') return width;
    const maxWidth = Math.max(MIN_DESKTOP_WIDTH, Math.floor(window.innerWidth * MAX_DESKTOP_WIDTH_RATIO));
    return Math.min(maxWidth, Math.max(MIN_DESKTOP_WIDTH, Math.round(width)));
}

function getDefaultDesktopWidth(): number {
    if (typeof window === 'undefined') return 320;
    return clampDesktopWidth(window.innerWidth * DEFAULT_DESKTOP_WIDTH_RATIO);
}

export default function OKKConsultantPanel({ selectedOrder }: { selectedOrder: PanelOrder | null }) {
    const pathname = usePathname();
    const section = useMemo(() => getConsultantSectionByPath(pathname), [pathname]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [threadId, setThreadId] = useState<string | null>(null);
    const [activeThreadIds, setActiveThreadIds] = useState<Record<string, string | null>>({});
    const [availableThreads, setAvailableThreads] = useState<Record<string, ThreadSummary[]>>({});
    const [queuedAction, setQueuedAction] = useState<ConsultantAskEventDetail | null>(null);
    const [threads, setThreads] = useState<Record<string, ChatMessage[]>>({});
    const [desktopWidth, setDesktopWidth] = useState<number | null>(null);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const resizeActiveRef = useRef(false);

    const threadKey = `${section.key}:${selectedOrder ? `order-${selectedOrder.order_id}` : 'global'}`;
    const currentContextThreadId = activeThreadIds[threadKey] || null;
    const messages = threads[threadKey] || [];
    const branchOptions = availableThreads[threadKey] || [];
    const activeThread = branchOptions.find((item) => item.id === threadId) || branchOptions[0] || null;

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const saved = window.localStorage.getItem(DESKTOP_WIDTH_STORAGE_KEY);
        if (saved) {
            const parsed = Number(saved);
            if (!Number.isNaN(parsed)) {
                setDesktopWidth(clampDesktopWidth(parsed));
                return;
            }
        }

        setDesktopWidth(getDefaultDesktopWidth());
    }, []);

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            if (!resizeActiveRef.current) return;
            const nextWidth = clampDesktopWidth(window.innerWidth - event.clientX);
            setDesktopWidth(nextWidth);
            window.localStorage.setItem(DESKTOP_WIDTH_STORAGE_KEY, String(nextWidth));
        };

        const stopResize = () => {
            if (!resizeActiveRef.current) return;
            resizeActiveRef.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', stopResize);

        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', stopResize);
        };
    }, []);

    useEffect(() => {
        setThreads((prev) => {
            if (prev[threadKey]) return prev;
            return {
                ...prev,
                [threadKey]: [],
            };
        });
    }, [threadKey]);

    useEffect(() => {
        let aborted = false;

        const loadHistory = async () => {
            try {
                const params = new URLSearchParams();
                params.set('sectionKey', section.key);
                if (selectedOrder?.order_id) params.set('orderId', String(selectedOrder.order_id));
                if (currentContextThreadId) params.set('threadId', currentContextThreadId);

                const res = await fetch(`/api/okk/consultant/history?${params.toString()}`);
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
                    [threadKey]: Array.isArray(data.messages)
                        ? data.messages.map((item: any) => ({
                            ...item,
                            metadata: item.metadata || null,
                        }))
                        : [],
                }));
            } catch {
                if (!aborted) {
                    setAvailableThreads((prev) => ({ ...prev, [threadKey]: prev[threadKey] || [] }));
                    setThreads((prev) => ({ ...prev, [threadKey]: prev[threadKey] || [] }));
                }
            }
        };

        void loadHistory();
        return () => {
            aborted = true;
        };
    }, [currentContextThreadId, section.key, selectedOrder?.order_id, threadKey]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);

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
                    body: JSON.stringify({
                        action: 'reset',
                        orderId: selectedOrder?.order_id ?? null,
                        threadId,
                        sectionKey: section.key,
                    }),
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
                    [threadKey]: [],
                }));
            }
        };

        void run();
    };

    const createBranch = () => {
        const run = async () => {
            try {
                const titleBase = selectedOrder
                    ? `Чат по заказу #${selectedOrder.order_id}`
                    : 'Общий чат';

                const res = await fetch('/api/okk/consultant/history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'create_branch',
                        orderId: selectedOrder?.order_id ?? null,
                        title: titleBase,
                        sectionKey: section.key,
                    }),
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
                    [threadKey]: [],
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
                    sectionKey: section.key,
                    selectionContext: selectedOrder?.sectionData || null,
                }),
            });
            const data = await res.json();

            if (data.threadId) {
                setThreadId(data.threadId);
                setActiveThreadIds((prev) => ({ ...prev, [threadKey]: data.threadId }));
            }

            pushMessage({
                id: `${threadKey}-agent-${Date.now()}`,
                role: 'agent',
                text: data.reply || data.error || 'Не удалось получить ответ.',
                createdAt: new Date().toISOString(),
            });
        } catch {
            pushMessage({
                id: `${threadKey}-error-${Date.now()}`,
                role: 'agent',
                text: 'Связь с консультантом не удалась. Повторите запрос.',
                createdAt: new Date().toISOString(),
            });
        } finally {
            setLoading(false);
        }
    }, [loading, pushMessage, section.key, selectedOrder?.order_id, selectedOrder?.sectionData, threadId, threadKey, threads]);

    useEffect(() => {
        if (!queuedAction) return;
        const selectedOrderId = selectedOrder?.order_id ?? null;
        if (queuedAction.orderId !== selectedOrderId || loading) return;
        void ask(queuedAction.prompt);
        setQueuedAction(null);
    }, [ask, loading, queuedAction, selectedOrder?.order_id]);

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
    }, [ask, selectedOrder?.order_id]);

    const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (window.innerWidth < 768) return;
        event.preventDefault();
        resizeActiveRef.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

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
                                    className="border border-slate-700 bg-slate-900/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
                                >
                                    Новый чат
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setMobileOpen(false)}
                                    className="flex h-6 w-6 items-center justify-center border border-slate-700 bg-slate-900/60 text-slate-300 md:hidden"
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

                <div className="mt-3 border border-slate-800 bg-[#0b141a] px-3 py-2 text-[10px] text-slate-400">
                    <div className="text-[10px] leading-relaxed text-slate-300">
                        Семён объясняет, как устроен ОКК: алгоритмы, поля, источники данных и логику расчёта.
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">
                        Конкретные заказы, правила и отмены он в этом чате не разбирает.
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                        <span>Чаты</span>
                        <span className="truncate text-right text-slate-400">{activeThread ? formatThreadTitle(activeThread) : 'Новый чат'}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-1">
                        <select
                            value={threadId || ''}
                            onChange={(event) => {
                                const nextThreadId = event.target.value || null;
                                setThreadId(nextThreadId);
                                setActiveThreadIds((prev) => ({ ...prev, [threadKey]: nextThreadId }));
                            }}
                            className="min-w-0 flex-1 border border-slate-800 bg-slate-950/70 px-2 py-1 text-[10px] text-slate-200 outline-none"
                            aria-label="Список чатов"
                        >
                            {branchOptions.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {formatThreadTitle(item)}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={createBranch}
                            className="border border-slate-700 bg-slate-900/60 px-2 py-1 text-[10px] font-black text-slate-200 hover:border-emerald-500/40"
                            aria-label="Создать чат"
                        >
                            +
                        </button>
                    </div>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-[#0b141a] bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.08),transparent_35%),linear-gradient(180deg,#0b141a_0%,#0a1015_100%)] px-2 py-3 overscroll-contain">
                <div className="space-y-2.5">
                    {messages.map((message) => {
                        const isUser = message.role === 'user';
                        const isSystem = message.role === 'system';
                        return (
                            <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                                <div
                                    className={`max-w-[92%] px-3 py-2 text-[11px] leading-relaxed shadow-md ${
                                        isUser
                                            ? 'bg-[#005c4b] text-white'
                                            : isSystem
                                                ? 'border border-slate-700 bg-[#202c33] text-slate-300'
                                                : 'bg-[#111b21] text-slate-100'
                                    }`}
                                >
                                    <div className="whitespace-pre-wrap break-words">{message.text}</div>
                                    <div className={`mt-1 text-right text-[9px] ${isUser ? 'text-emerald-100/70' : 'text-slate-400'}`}>
                                        {formatTime(message.createdAt)}
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {loading && (
                        <div className="flex justify-start">
                            <div className="bg-[#111b21] px-3 py-2 text-[11px] text-slate-300 shadow-md">
                                Семён собирает ответ...
                            </div>
                        </div>
                    )}
                </div>

                <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSubmit} className="border-t border-slate-800 bg-[#111b21] px-2 py-2">
                <div className="flex items-end gap-2">
                    <textarea
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        rows={3}
                        placeholder="Спросите про алгоритмы ОКК, поля, критерии или источники данных..."
                        className="min-h-[76px] flex-1 resize-none border border-slate-800 bg-[#0b141a] px-3 py-2 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-500/40"
                    />
                    <button
                        type="submit"
                        disabled={loading || !input.trim()}
                        className="flex h-11 w-11 items-center justify-center bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:shadow-none"
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
            <aside
                className="relative hidden h-full min-h-0 shrink-0 flex-col overflow-hidden border border-slate-800/80 bg-[#0f1726] text-slate-100 shadow-[0_18px_40px_rgba(2,6,23,0.24)] md:flex md:w-[15vw] md:min-w-[15vw] md:max-w-[15vw]"
                style={desktopWidth ? { width: `${desktopWidth}px`, minWidth: `${desktopWidth}px`, maxWidth: `${desktopWidth}px` } : undefined}
            >
                <div
                    className="absolute inset-y-0 left-0 z-10 hidden w-3 cursor-col-resize md:block"
                    onPointerDown={startResize}
                    aria-hidden="true"
                >
                    <div className="ml-0.5 h-full w-px bg-slate-700/70" />
                </div>
                {panelContent}
            </aside>

            <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="fixed bottom-4 right-4 z-[140] flex items-center gap-2 border border-emerald-400/30 bg-[#111b21] px-3 py-2 text-xs font-black text-white shadow-[0_12px_32px_rgba(2,6,23,0.45)] md:hidden"
            >
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                Семён
            </button>

            {mobileOpen && (
                <div className="fixed inset-0 z-[150] md:hidden">
                    <button type="button" aria-label="Закрыть слой" className="absolute inset-0 bg-slate-950/70" onClick={() => setMobileOpen(false)} />
                    <aside className="absolute inset-x-0 bottom-0 top-14 flex flex-col overflow-hidden border-t border-slate-800/80 bg-[#0f1726] text-slate-100 shadow-[0_-16px_40px_rgba(2,6,23,0.48)]">
                        {panelContent}
                    </aside>
                </div>
            )}
        </>
    );
}