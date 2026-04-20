'use client';

import React from 'react';
import ChatAvatar from './ChatAvatar';
import { getChatAvatarUrl, getChatDisplayName } from './chat-identity';
import type { MessengerChat, MessengerParticipant } from './types';

interface ChatListProps {
    chats: MessengerChat[];
    selectedId: string | null;
    currentUserId?: number;
    onSelect: (id: string) => void;
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
        <div className="flex flex-col divide-y divide-slate-200 bg-white md:divide-y-0 md:bg-transparent">
            {chats.map((chat) => {
                const isSelected = selectedId === chat.id;
                const lastMsg = chat.last_message;
                const displayName = getChatDisplayName(chat, currentUserId) || 'Чат';
                const unreadCount = chat.unread_count || 0;
                const directParticipant = chat.chat_participants?.find((participant: MessengerParticipant) => participant.user_id !== currentUserId);

                return (
                    <button
                        key={chat.id}
                        onClick={() => onSelect(chat.id)}
                        className={`w-full rounded-none border-0 px-4 py-3 text-left transition-all md:mx-2 md:my-1.5 md:rounded-[22px] md:border ${
                            isSelected
                                ? 'bg-sky-50 md:border-sky-200 md:shadow-sm md:shadow-sky-100'
                                : 'bg-white hover:bg-slate-50 md:border-transparent md:hover:border-slate-200'
                        }`}
                    >
                        <div className="flex items-start gap-3">
                            <ChatAvatar
                                avatarUrl={getChatAvatarUrl(chat, currentUserId)}
                                firstName={chat.type === 'direct' ? directParticipant?.managers?.first_name : null}
                                lastName={chat.type === 'direct' ? directParticipant?.managers?.last_name : null}
                                fallback={displayName}
                                type={chat.type}
                            />

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
                                    {unreadCount > 0 && (
                                        <span className="flex h-6 min-w-[24px] items-center justify-center rounded-full bg-sky-500 px-1.5 text-[11px] font-bold text-white shadow-sm shadow-sky-200">
                                            {unreadCount > 99 ? '99+' : unreadCount}
                                        </span>
                                    )}
                                </div>
                                <div className="mt-2 flex items-center gap-2">
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
