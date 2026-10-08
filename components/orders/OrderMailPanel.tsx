'use client';

/**
 * Раздел «Переписка» в карточке заказа.
 *
 * Постановка — `docs/order-mail/TZ.md` §4. Две колонки, edge-to-edge, без
 * карточек и теней (`golds/`): слева разговоры заказа, справа открытый.
 * Цитата свёрнута — иначе лента превращается в кашу из «>».
 *
 * Ответ пишется прямо в треде, не модалкой (ТЗ §4): адресат, тема и цитата
 * берутся из письма, на которое отвечают. Отложенная отправка — следующий шаг,
 * и об этом сказано в интерфейсе.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OrderReplyForm from '@/components/orders/OrderReplyForm';

type Attachment = { name: string; size: number | null };

type Message = {
    key: string;
    direction: 'in' | 'out';
    subject: string | null;
    from: string | null;
    fromName: string | null;
    to: string | null;
    at: string | null;
    text: string;
    quoted: string | null;
    attachments: Attachment[];
    emailId: string | null;
    read: boolean;
};

type Thread = {
    key: string;
    subject: string;
    state: 'awaiting_us' | 'awaiting_client' | 'closed';
    stateLabel: string;
    lastAt: string | null;
    unread: number;
    participants: string[];
    messages: Message[];
};

const when = (value: string | null): string => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    return sameDay
        ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

const size = (bytes: number | null): string => {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
};

/** Цвет состояния: ждём нас — это долг, он должен быть заметен. */
const stateClass = (state: Thread['state']): string => {
    if (state === 'awaiting_us') return 'text-red-700';
    if (state === 'closed') return 'text-gray-400';
    return 'text-gray-500';
};

export default function OrderMailPanel({ orderNumber, onUnread }: { orderNumber: string; onUnread?: (count: number) => void }) {
    const [threads, setThreads] = useState<Thread[] | null>(null);
    const [openKey, setOpenKey] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [query, setQuery] = useState('');
    const marked = useRef<Set<string>>(new Set());
    /** На какое письмо отвечаем. null — композер закрыт. */
    const [replyTo, setReplyTo] = useState<{ to?: string | null; subject?: string | null; quote?: string | null } | null>(null);
    const [composing, setComposing] = useState(false);
    /** Поле поиска и открытый тред — чтобы горячие клавиши видели свежее состояние. */
    const searchRef = useRef<HTMLInputElement | null>(null);
    const openRef = useRef<Thread | null>(null);
    const toggleClosedRef = useRef<((thread: Thread) => Promise<void>) | null>(null);

    const load = useCallback(async () => {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/mail`);
        const data = await res.json().catch(() => null);
        const list = (data?.threads || []) as Thread[];
        setThreads(list);
        onUnread?.(Number(data?.unread ?? 0));
        setOpenKey((current) => current ?? (list.length ? list[0].key : null));
    }, [orderNumber, onUnread]);

    useEffect(() => { void load(); }, [load]);

    const open = useMemo(
        () => (threads || []).find((thread) => thread.key === openKey) || null,
        [threads, openKey],
    );

    useEffect(() => { openRef.current = open; }, [open]);

    /**
     * Открытый тред считается прочитанным. Отмечаем в ОКК, флаг `\Seen` в
     * ящике не трогаем — на нём держится автоприём Катерины.
     */
    useEffect(() => {
        if (!open) return;
        const keys = open.messages.filter((m) => m.direction === 'in' && !m.read && !marked.current.has(m.key)).map((m) => m.key);
        if (!keys.length) return;
        for (const key of keys) marked.current.add(key);

        void fetch(`/api/orders/${encodeURIComponent(orderNumber)}/mail`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'read', messageKeys: keys }),
        }).then(() => load());
    }, [open, orderNumber, load]);

    /**
     * Сочетания клавиш (ТЗ §4): для тридцати писем в день это разница в разы.
     * `r` — ответить, `e` — закрыть тред, `u` — к списку, `/` — поиск.
     * Пока человек печатает в поле, клавиши не перехватываем.
     */
    useEffect(() => {
        const typing = (el: EventTarget | null): boolean => {
            const node = el as HTMLElement | null;
            const tag = node?.tagName?.toLowerCase();
            return tag === 'input' || tag === 'textarea' || Boolean(node?.isContentEditable);
        };

        const onKey = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
            const thread = openRef.current;

            if (event.key === '/') {
                event.preventDefault();
                searchRef.current?.focus();
                return;
            }
            if (!thread) return;

            if (event.key === 'r' || event.key === 'к') {
                event.preventDefault();
                const last = [...thread.messages].reverse().find((m) => m.direction === 'in') || thread.messages[thread.messages.length - 1];
                setReplyTo({ to: last.from || thread.participants[0] || null, subject: last.subject, quote: last.text });
                setComposing(true);
            } else if (event.key === 'e' || event.key === 'у') {
                event.preventDefault();
                void toggleClosedRef.current?.(thread);
            } else if (event.key === 'u' || event.key === 'г') {
                event.preventDefault();
                setComposing(false);
            }
        };

        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const toggleClosed = async (thread: Thread) => {
        await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/mail`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: thread.state === 'closed' ? 'reopen' : 'close', threadKey: thread.key }),
        });
        await load();
    };

    useEffect(() => { toggleClosedRef.current = toggleClosed; });

    const found = useMemo(() => {
        const text = query.trim().toLowerCase();
        if (!text) return threads || [];
        return (threads || []).filter((thread) =>
            thread.subject.toLowerCase().includes(text)
            || thread.participants.some((p) => p.toLowerCase().includes(text))
            || thread.messages.some((m) =>
                (m.text || '').toLowerCase().includes(text)
                || m.attachments.some((a) => a.name.toLowerCase().includes(text))),
        );
    }, [threads, query]);

    if (threads === null) return <p className="text-sm text-gray-500">Загружаем переписку…</p>;
    if (!threads.length) return <p className="text-sm text-gray-500">Писем по заказу нет.</p>;

    return (
        <div className="flex gap-0 border border-gray-200">
            <div className="w-64 shrink-0 border-r border-gray-200">
                <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Поиск по переписке (/)"
                    className="w-full border-b border-gray-200 px-2 py-1.5 text-xs focus:border-blue-600 focus:outline-none"
                />
                <ul className="max-h-[360px] overflow-y-auto">
                    {found.map((thread) => (
                        <li key={thread.key}>
                            <button
                                onClick={() => setOpenKey(thread.key)}
                                className={`w-full border-b border-gray-100 px-2 py-2 text-left hover:bg-gray-50 ${thread.key === openKey ? 'bg-gray-100' : ''}`}
                            >
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className={`truncate text-[13px] ${thread.unread ? 'font-bold text-gray-900' : 'text-gray-800'}`}>
                                        {thread.subject}
                                    </span>
                                    <span className="shrink-0 text-[10px] text-gray-400">{when(thread.lastAt)}</span>
                                </div>
                                <div className="mt-0.5 flex items-center justify-between gap-2">
                                    <span className="truncate text-[11px] text-gray-500">
                                        {thread.participants[0] || 'переписка по заказу'}
                                    </span>
                                    <span className={`shrink-0 text-[10px] font-semibold ${stateClass(thread.state)}`}>
                                        {thread.unread ? `${thread.unread} новых` : thread.stateLabel}
                                    </span>
                                </div>
                            </button>
                        </li>
                    ))}
                    {!found.length && <li className="px-2 py-3 text-xs text-gray-500">Ничего не нашли.</li>}
                </ul>
            </div>

            <div className="min-w-0 flex-1">
                {open && (
                    <>
                        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-3 py-2">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-gray-900">{open.subject}</p>
                                <p className="text-[11px] text-gray-500">
                                    {open.stateLabel}
                                    {open.participants.length ? ` · ${open.participants.join(', ')}` : ''}
                                </p>
                            </div>
                            <button
                                onClick={() => {
                                    const last = [...open.messages].reverse().find((m) => m.direction === 'in') || open.messages[open.messages.length - 1];
                                    setReplyTo({ to: last.from || open.participants[0] || null, subject: last.subject, quote: last.text });
                                    setComposing(true);
                                }}
                                className="shrink-0 border border-blue-600 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50"
                            >
                                Ответить
                            </button>
                            <button
                                onClick={() => toggleClosed(open)}
                                className="shrink-0 border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                            >
                                {open.state === 'closed' ? 'Вернуть в работу' : 'Закрыть тред'}
                            </button>
                        </div>

                        <div className="max-h-[360px] overflow-y-auto">
                            {open.messages.map((message) => (
                                <article
                                    key={message.key}
                                    className={`border-b border-gray-100 px-3 py-2 ${message.direction === 'out' ? 'bg-blue-50/40' : ''}`}
                                >
                                    <header className="flex items-baseline justify-between gap-2">
                                        <span className="truncate text-xs font-semibold text-gray-900">
                                            {message.direction === 'in'
                                                ? (message.fromName || message.from || 'Клиент')
                                                : `Мы → ${message.to || 'клиенту'}`}
                                        </span>
                                        <span className="shrink-0 text-[10px] text-gray-400">{when(message.at)}</span>
                                    </header>

                                    <p className="mt-1 whitespace-pre-wrap text-[13px] leading-snug text-gray-800">
                                        {message.text || '— пусто —'}
                                    </p>

                                    {message.quoted && (
                                        <>
                                            <button
                                                onClick={() => setExpanded((current) => {
                                                    const next = new Set(current);
                                                    if (next.has(message.key)) next.delete(message.key);
                                                    else next.add(message.key);
                                                    return next;
                                                })}
                                                className="mt-1 text-[11px] font-semibold text-blue-700 hover:underline"
                                            >
                                                {expanded.has(message.key) ? 'Скрыть цитату' : '··· показать цитату'}
                                            </button>
                                            {expanded.has(message.key) && (
                                                <pre className="mt-1 whitespace-pre-wrap border-l-2 border-gray-200 pl-2 text-[11px] text-gray-500">
                                                    {message.quoted}
                                                </pre>
                                            )}
                                        </>
                                    )}

                                    <button
                                        onClick={() => {
                                            setReplyTo({ to: message.from || open.participants[0] || null, subject: message.subject, quote: message.text });
                                            setComposing(true);
                                        }}
                                        className="mt-1 mr-3 text-[11px] font-semibold text-blue-700 hover:underline"
                                    >
                                        ответить
                                    </button>

                                    {message.attachments.length > 0 && (
                                        <ul className="mt-1.5 flex flex-wrap gap-2">
                                            {message.attachments.map((file) => (
                                                <li key={file.name} className="text-[11px]">
                                                    {message.emailId ? (
                                                        <a
                                                            href={`/api/orders/${encodeURIComponent(orderNumber)}/files/download?emailId=${encodeURIComponent(message.emailId)}&name=${encodeURIComponent(file.name)}`}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="font-semibold text-blue-700 hover:underline"
                                                        >
                                                            {file.name}
                                                        </a>
                                                    ) : (
                                                        <span className="text-gray-600">{file.name}</span>
                                                    )}
                                                    {size(file.size) ? <span className="ml-1 text-gray-400">{size(file.size)}</span> : null}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </article>
                            ))}
                        </div>

                        {composing && (
                            /* Композер в треде, а не поверх карточки: человек видит,
                               на что отвечает, пока пишет. */
                            <div className="border-t border-gray-300">
                                <OrderReplyForm
                                    orderNumber={orderNumber}
                                    replyTo={replyTo}
                                    onClose={() => { setComposing(false); setReplyTo(null); }}
                                    onSent={() => { setComposing(false); setReplyTo(null); void load(); }}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
