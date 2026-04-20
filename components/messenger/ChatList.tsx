'use client';

import React from 'react';
import type { MessengerChat, MessengerParticipant } from './types';

interface ChatListProps {
    chats: MessengerChat[];
    selectedId: string | null;
    currentUserId?: number;
    onSelect: (id: string) => void;
}

function getChatDisplayName(chat: MessengerChat, currentUserId?: number) {
    if (chat.type !== 'direct') {
        return chat.name || 'Диалог';
    }

    const otherParticipant = chat.chat_participants?.find((participant: MessengerParticipant) => participant.user_id !== currentUserId);
    const firstName = otherParticipant?.managers?.first_name || '';
    const lastName = otherParticipant?.managers?.last_name || '';
    const fullName = `${firstName} ${lastName}`.trim();

    return fullName || chat.name || 'Личный чат';
}

export default function ChatList({ chats, selectedId, currentUserId, onSelect }: ChatListProps) {
    if (chats.length === 0) {
        return (
            <div className="px-6 py-12 text-center text-sm text-slate-400">
                Чатов пока нет
            </div>
        );
    }

    return (
        <div className="flex flex-col">
            {chats.map((chat) => {
                const isSelected = selectedId === chat.id;
                const lastMsg = chat.last_message;
                const displayName = getChatDisplayName(chat, currentUserId);

                return (
                    <button
                        key={chat.id}
                        onClick={() => onSelect(chat.id)}
                        className={`mx-2 my-1.5 rounded-[22px] border px-3 py-3 text-left transition-all ${
                            isSelected
                                ? 'border-sky-200 bg-sky-50 shadow-sm shadow-sky-100'
                                : 'border-transparent bg-white hover:border-slate-200 hover:bg-slate-50'
                        }`}
                    >
                        <div className="flex items-start gap-3">
                            <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                                chat.type === 'group'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-sky-100 text-sky-800'
                            }`}>
                                {displayName.slice(0, 2).toUpperCase()}
                            </div>

                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-900">
                                        {displayName}
                                    </span>
                                    <span className="whitespace-nowrap text-[11px] text-slate-400">
                                        {lastMsg ? new Date(lastMsg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                    </span>
                                </div>

                                <div className="mt-1 flex items-end gap-2">
                                    <p className="min-h-[1.25rem] flex-1 truncate text-[13px] leading-5 text-slate-500">
                                        {lastMsg?.content || 'Нет сообщений'}
                                    </p>
                                    {chat.unread_count > 0 && (
                                        <span className="flex h-6 min-w-[24px] items-center justify-center rounded-full bg-sky-500 px-1.5 text-[11px] font-bold text-white shadow-sm shadow-sky-200">
                                            {chat.unread_count > 99 ? '99+' : chat.unread_count}
                                        </span>
                                    )}
                                </div>

                                <div className="mt-2 flex items-center gap-2">
                                    {chat.type === 'group' && (
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                            Группа
                                        </span>
                                    )}

                                    {chat.context_order_id && (
                                        <span className="inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-700">
                                            Заказ {chat.context_order_id}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
