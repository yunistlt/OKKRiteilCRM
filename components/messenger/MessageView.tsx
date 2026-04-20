'use client';

import React, { useState, useEffect, useRef } from 'react';
import { supabaseBrowser } from '@/utils/supabase-browser';
import MessageInput, { PendingMessageDraft } from './MessageInput';
import ChatMembersModal from './ChatMembersModal';
import type {
    MessengerAttachment,
    MessengerChat,
    MessengerMessage,
    MessengerOrderContext,
    MessengerParticipant,
} from './types';

interface MessageViewProps {
    chatId: string;
    highlightedMessageId?: string | null;
    currentUserId?: number;
    chatName?: string;
    participants?: MessengerParticipant[];
    chatType?: MessengerChat['type'];
    contextOrder?: MessengerOrderContext | null;
    onBack?: () => void;
    onMembersChanged?: () => void;
    onLeftChat?: () => void;
    onDeletedChat?: () => void;
}

type MessagesResponse = {
    messages?: MessengerMessage[];
    total?: number;
};

export default function MessageView({ chatId, highlightedMessageId, currentUserId, chatName, participants, chatType, contextOrder, onBack, onMembersChanged, onLeftChat, onDeletedChat }: MessageViewProps) {
    const pageSize = 50;
    const [messages, setMessages] = useState<MessengerMessage[]>([]);
    const [pendingMessages, setPendingMessages] = useState<MessengerMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
    const [messagesError, setMessagesError] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMoreMessages, setHasMoreMessages] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const didScrollToHighlightRef = useRef(false);

    useEffect(() => {
        didScrollToHighlightRef.current = false;
        fetchMessages('reset', highlightedMessageId || undefined);
        setPendingMessages([]);
        if (!supabaseBrowser.isConfigured) {
            return;
        }

        const channel = supabaseBrowser
            .channel(`chat-${chatId}`)
            ?.on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `chat_id=eq.${chatId}`
            }, (payload) => {
                setMessages((prev) => [...prev, payload.new as MessengerMessage]);
            })
            ?.subscribe();

        return () => {
            supabaseBrowser.removeChannel(channel);
        };
    }, [chatId, highlightedMessageId]);

    useEffect(() => {
        // Scroll to bottom when messages change
        if (scrollRef.current && !highlightedMessageId) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, pendingMessages, highlightedMessageId]);

    useEffect(() => {
        if (!highlightedMessageId || didScrollToHighlightRef.current === true) {
            return;
        }

        const container = scrollRef.current;
        const targetElement = container?.querySelector<HTMLElement>(`[data-message-id="${highlightedMessageId}"]`);
        if (!container || !targetElement) {
            return;
        }

        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        didScrollToHighlightRef.current = true;
    }, [messages, highlightedMessageId]);

    const fetchMessagesPage = async (offset: number) => {
        const res = await fetch(`/api/messenger/messages?chat_id=${chatId}&limit=${pageSize}&offset=${offset}`);
        if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error(data?.error || 'Не удалось загрузить сообщения');
        }

        return res.json() as Promise<MessagesResponse>;
    };

    const fetchMessages = async (mode: 'reset' | 'older' = 'reset', targetMessageId?: string) => {
        const offset = mode === 'older' ? messages.length : 0;

        if (mode === 'reset') {
            setLoading(true);
            setMessagesError(null);
        } else {
            setLoadingMore(true);
        }

        try {
            if (mode === 'reset' && targetMessageId) {
                let nextOffset = 0;
                let total = 0;
                let foundTarget = false;
                const collectedPages: MessengerMessage[] = [];

                while (!foundTarget) {
                    const data = await fetchMessagesPage(nextOffset);
                    const pageMessages = Array.isArray(data.messages) ? data.messages : [];
                    total = data.total || 0;
                    collectedPages.push(...pageMessages);
                    foundTarget = pageMessages.some((message) => message.id === targetMessageId);

                    if (foundTarget || pageMessages.length === 0 || nextOffset + pageMessages.length >= total) {
                        break;
                    }

                    nextOffset += pageMessages.length;
                }

                const nextMessages = [...collectedPages].reverse();
                setMessages(nextMessages);
                setHasMoreMessages(total > collectedPages.length);
            } else {
                const data = await fetchMessagesPage(offset);
                if (data.messages) {
                    const nextMessages = [...(data.messages as MessengerMessage[])].reverse();

                    setMessages((prev) => {
                        if (mode === 'older') {
                            return [...nextMessages, ...prev];
                        }
                        return nextMessages;
                    });

                    setHasMoreMessages((data.total || 0) > offset + nextMessages.length);
                }
            }

            if (mode === 'reset') {
                markMessagesAsRead();
            }
        } catch (error) {
            console.error('Failed to fetch messages:', error);
            setMessagesError(error instanceof Error ? error.message : 'Не удалось загрузить сообщения');
        } finally {
            if (mode === 'reset') {
                setLoading(false);
            }
            setLoadingMore(false);
        }
    };

    const markMessagesAsRead = async () => {
        if (!chatId) return;
        try {
            await fetch('/api/messenger/chats', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId })
            });
        } catch (error) {
            console.error('Failed to mark as read:', error);
        }
    };

    const formatTime = (dateStr: string) => {
        return new Date(dateStr).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    };

    const renderedMessages = [...messages, ...pendingMessages].sort((left, right) => {
        return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
    });

    // Group messages by date
    const groupedMessages = renderedMessages.reduce((acc: { date: string; msgs: MessengerMessage[] }[], msg) => {
        const date = new Date(msg.created_at).toLocaleDateString('ru-RU', {
            day: 'numeric', month: 'long', year: 'numeric'
        });
        const last = acc[acc.length - 1];
        if (last && last.date === date) {
            last.msgs.push(msg);
        } else {
            acc.push({ date, msgs: [msg] });
        }
        return acc;
    }, []);

    const handlePendingMessageCreated = (draft: PendingMessageDraft) => {
        setPendingMessages((prev) => ([
            ...prev,
            {
                id: draft.localId,
                local_id: draft.localId,
                sender_id: currentUserId,
                content: draft.content,
                attachments: draft.attachments || [],
                created_at: new Date().toISOString(),
                _status: 'sending',
            }
        ]));
    };

    const handlePendingMessageStatusChange = (localId: string, status: 'sending' | 'failed') => {
        setPendingMessages((prev) => prev.map((message) => (
            message.local_id === localId
                ? { ...message, _status: status }
                : message
        )));
    };

    const handlePendingMessageResolved = (localId: string) => {
        setPendingMessages((prev) => prev.filter((message) => message.local_id !== localId));
    };

    const handleDeleteMessage = async (messageId: string) => {
        const confirmed = window.confirm('Удалить это сообщение?');
        if (!confirmed) return;

        try {
            const res = await fetch('/api/messenger/messages', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message_id: messageId })
            });

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || 'Не удалось удалить сообщение');
            }

            setMessages((prev) => prev.filter((message) => message.id !== messageId));
            onMembersChanged?.();
        } catch (error) {
            console.error('Failed to delete message:', error);
            alert(error instanceof Error ? error.message : 'Не удалось удалить сообщение');
        }
    };

    return (
        <div className="flex h-full flex-1 flex-col bg-[linear-gradient(180deg,_#dfe9f3_0%,_#edf3f8_14%,_#f8fbff_34%,_#ffffff_100%)]">
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/92 px-3 py-3 shadow-sm backdrop-blur-sm md:px-5 md:py-4">
                <div className="flex items-start gap-3">
                    <button
                        type="button"
                        onClick={onBack}
                        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 md:hidden"
                        aria-label="Назад к списку чатов"
                    >
                        <span className="text-lg">‹</span>
                    </button>
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-sky-500 text-base font-bold text-white shadow-sm shadow-sky-200">
                        {chatName ? chatName[0].toUpperCase() : 'Ч'}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold text-slate-900">{chatName || 'Чат'}</div>
                        {contextOrder?.order_id && (
                            <a
                                href={contextOrder.retailcrm_url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-800 transition hover:border-cyan-300 hover:bg-cyan-100"
                            >
                                <span>Заказ #{contextOrder.number || contextOrder.order_id}</span>
                                {contextOrder.status && (
                                    <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-cyan-900">
                                        {contextOrder.status}
                                    </span>
                                )}
                            </a>
                        )}
                        {chatType === 'group' ? (
                            <button
                                onClick={() => setIsMembersModalOpen(true)}
                                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-sky-700"
                            >
                                <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                                {participants ? `${participants.length} участник${participants.length === 1 ? '' : participants.length < 5 ? 'а' : 'ов'}` : 'участники'}
                            </button>
                        ) : (
                            <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                {participants ? `${participants.length} участников` : 'в сети'}
                            </div>
                        )}
                    </div>
                    {chatType === 'group' && (
                        <button
                            type="button"
                            onClick={() => setIsMembersModalOpen(true)}
                            className="hidden h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 md:inline-flex"
                        >
                            Участники
                        </button>
                    )}
                </div>
            </div>

            <div ref={scrollRef} className="no-scrollbar flex flex-1 flex-col gap-4 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.4),_transparent_35%),linear-gradient(180deg,_rgba(248,251,255,0.92)_0%,_rgba(255,255,255,0.98)_28%,_#ffffff_100%)] px-3 py-4 md:px-6 md:py-5">
                {loading ? (
                    <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
                        Загрузка сообщений...
                    </div>
                ) : messagesError ? (
                    <div className="flex flex-1 items-center justify-center p-6">
                        <div className="w-full max-w-md rounded-3xl border border-rose-200 bg-rose-50 p-5 text-rose-800 shadow-sm">
                            <div className="text-sm font-semibold">Не удалось загрузить сообщения</div>
                            <div className="mt-2 text-sm leading-6">{messagesError}</div>
                            <button
                                type="button"
                                onClick={fetchMessages}
                                className="mt-4 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
                            >
                                Повторить
                            </button>
                        </div>
                    </div>
                ) : groupedMessages.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center">
                        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-500 shadow-sm">
                            Нет сообщений. Напишите первым.
                        </div>
                    </div>
                ) : (
                    <>
                        {hasMoreMessages && (
                            <div className="flex justify-center">
                                <button
                                    type="button"
                                    onClick={() => fetchMessages('older')}
                                    disabled={loadingMore}
                                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-default disabled:opacity-60"
                                >
                                    {loadingMore ? 'Загрузка...' : 'Показать более ранние сообщения'}
                                </button>
                            </div>
                        )}

                        {groupedMessages.map((group) => (
                            <React.Fragment key={group.date}>
                                <div className="flex justify-center">
                                    <span className="rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 shadow-sm">
                                        {group.date}
                                    </span>
                                </div>

                                {group.msgs.map((msg, idx) => {
                                    const isSystem = msg.sender_id === null || msg.sender_id === undefined;
                                    const isMine = !isSystem && Number(msg.sender_id) === Number(currentUserId);
                                    const isPending = msg._status === 'sending';
                                    const isFailed = msg._status === 'failed';
                                    const canDelete = isMine && !isPending && !isFailed && typeof msg.id === 'string';

                                    const otherParticipants = participants?.filter((participant) => participant.user_id !== currentUserId) || [];
                                    const latestReadAt = otherParticipants.length > 0
                                        ? Math.max(...otherParticipants.map((participant) => new Date(participant.last_read_at).getTime()))
                                        : 0;
                                    const isRead = new Date(msg.created_at).getTime() <= latestReadAt;

                                    const prevMsg = group.msgs[idx - 1];
                                    const showSenderName = !isMine && !isSystem && msg.sender_id !== prevMsg?.sender_id;

                                    if (isSystem) {
                                        return (
                                            <div key={msg.id} className="flex justify-center">
                                                <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
                                                    {msg.content}
                                                </span>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div
                                            key={msg.id}
                                            data-message-id={msg.id}
                                            className={`flex ${isMine ? 'justify-end pl-[6%] md:pl-[14%]' : 'justify-start pr-[6%] md:pr-[14%]'}`}
                                        >
                                            <div className={`flex max-w-full flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                                                {showSenderName && (
                                                    <span className="mb-1 px-1 text-xs font-semibold text-sky-700">
                                                        {participants?.find((participant) => participant.user_id === msg.sender_id)?.managers?.first_name || 'Сотрудник'}
                                                    </span>
                                                )}

                                                <div
                                                    className={`relative max-w-[min(100%,42rem)] rounded-[22px] border px-4 py-3 text-sm leading-6 shadow-sm ${
                                                        isFailed
                                                            ? 'border-rose-200 bg-rose-50 text-rose-950'
                                                            : highlightedMessageId === msg.id
                                                                ? isMine
                                                                    ? 'border-amber-300 bg-amber-50 text-slate-950 ring-2 ring-amber-200'
                                                                    : 'border-amber-300 bg-amber-50 text-slate-950 ring-2 ring-amber-200'
                                                            : isMine
                                                                ? 'border-emerald-200 bg-[#dcf8c6] text-slate-900'
                                                                : 'border-slate-200 bg-white text-slate-900'
                                                    } ${canDelete ? 'pr-14' : ''}`}
                                                >
                                                    {canDelete && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteMessage(msg.id)}
                                                            className="absolute right-3 top-3 text-xs font-semibold text-slate-400 transition hover:text-rose-600"
                                                            title="Удалить сообщение"
                                                        >
                                                            ✕
                                                        </button>
                                                    )}

                                                    {msg.content && (
                                                        <p className="m-0 whitespace-pre-wrap break-words">
                                                            {msg.content}
                                                        </p>
                                                    )}

                                                    {msg.attachments && msg.attachments.length > 0 && (
                                                        <div className="mt-3 flex flex-col gap-2">
                                                            {msg.attachments.map((att: MessengerAttachment, i: number) => {
                                                                const attachmentHref = `/api/messenger/attachments?chat_id=${encodeURIComponent(chatId)}&path=${encodeURIComponent(att.path || '')}`;
                                                                const isImage = typeof att.type === 'string' && att.type.startsWith('image/');

                                                                if (isImage) {
                                                                    return (
                                                                        <a
                                                                            key={i}
                                                                            href={attachmentHref}
                                                                            target="_blank"
                                                                            rel="noreferrer"
                                                                            className="overflow-hidden rounded-2xl border border-slate-200 bg-white/70 transition hover:border-slate-300"
                                                                        >
                                                                            <img
                                                                                src={attachmentHref}
                                                                                alt={att.name || 'Изображение'}
                                                                                className="block max-h-[220px] w-full max-w-[220px] object-cover sm:max-w-[240px]"
                                                                            />
                                                                            <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-sky-700">
                                                                                <span>🖼</span>
                                                                                <span className="truncate">{att.name || 'Изображение'}</span>
                                                                            </div>
                                                                        </a>
                                                                    );
                                                                }

                                                                return (
                                                                    <a
                                                                        key={i}
                                                                        href={attachmentHref}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                        className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold transition ${
                                                                            isMine
                                                                                ? 'border-sky-200 bg-white text-sky-700 hover:bg-sky-100'
                                                                                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                                                                        }`}
                                                                    >
                                                                        <span>📎</span>
                                                                        <span className="truncate">{att.name || 'Файл'}</span>
                                                                    </a>
                                                                );
                                                            })}
                                                        </div>
                                                    )}

                                                    <div className="mt-3 flex items-center justify-end gap-2 text-[11px] text-slate-400">
                                                        {(isPending || isFailed) && (
                                                            <span className={isFailed ? 'font-medium text-rose-600' : 'font-medium text-amber-600'}>
                                                                {isFailed ? 'Ошибка' : 'Отправка...'}
                                                            </span>
                                                        )}
                                                        <span>{formatTime(msg.created_at)}</span>
                                                        {isMine && !isPending && !isFailed && (
                                                            <span className={isRead ? 'text-sky-600' : 'text-slate-400'}>
                                                                {isRead ? '✓✓' : '✓'}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </React.Fragment>
                        ))}
                    </>
                )}
            </div>

            <MessageInput
                chatId={chatId}
                onMessageSent={fetchMessages}
                onPendingMessageCreated={handlePendingMessageCreated}
                onPendingMessageStatusChange={handlePendingMessageStatusChange}
                onPendingMessageResolved={handlePendingMessageResolved}
            />

            {isMembersModalOpen && (
                <ChatMembersModal
                    chatId={chatId}
                    chatType={chatType}
                    chatName={chatName}
                    currentUserId={currentUserId}
                    onClose={() => setIsMembersModalOpen(false)}
                    onLeftChat={onLeftChat}
                    onDeletedChat={onDeletedChat}
                    onMembersChanged={() => {
                        onMembersChanged?.();
                        setIsMembersModalOpen(false);
                    }}
                />
            )}
        </div>
    );
}
