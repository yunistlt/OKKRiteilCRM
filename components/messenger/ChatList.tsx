'use client';

import React from 'react';

interface ChatListProps {
    chats: any[];
    selectedId: string | null;
    onSelect: (id: string) => void;
}

export default function ChatList({ chats, selectedId, onSelect }: ChatListProps) {
    if (chats.length === 0) {
        return (
            <div className="p-8 text-center text-gray-400">
                Чатов пока нет
            </div>
        );
    }

    return (
        <div className="flex flex-col">
            {chats.map((chat) => {
                const isSelected = selectedId === chat.id;
                const lastMsg = chat.last_message;
                
                // Get chat display name
                let displayName = chat.name || 'Диалог';
                if (chat.type === 'direct') {
                    // Find the other participant's name
                    // Since we are currently hardcoding ourselves as participants, 
                    // we'd need to filter out the current user.
                    // For now, let's just show the participants' names.
                    const otherPart = chat.chat_participants?.find((p: any) => p.managers?.id !== chat.user_id); // This needs current user ID
                    if (otherPart?.managers) {
                        displayName = `${otherPart.managers.first_name} ${otherPart.managers.last_name}`;
                    }
                }

                return (
                    <button
                        key={chat.id}
                        onClick={() => onSelect(chat.id)}
                        className={`p-4 text-left border-b transition-colors flex flex-col gap-1 ${
                            isSelected ? 'bg-blue-50' : 'hover:bg-gray-100'
                        }`}
                    >
                        <div className="flex justify-between items-center">
                            <span className="font-semibold text-gray-900 truncate flex-1 pr-2">
                                {displayName}
                            </span>
                            <span className="text-[10px] text-gray-400 whitespace-nowrap">
                                {lastMsg ? new Date(lastMsg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                            </span>
                        </div>
                        
                        <div className="flex justify-between items-end">
                            <p className="text-xs text-gray-500 truncate flex-1 min-h-[1rem]">
                                {lastMsg?.content || 'Нет сообщений'}
                            </p>
                            {/* TODO: Add Unread Badge */}
                        </div>

                        {chat.context_order_id && (
                            <div className="mt-1">
                                <span className="inline-block px-1.5 py-0.5 bg-gray-200 text-gray-600 text-[10px] rounded uppercase font-bold tracking-tighter">
                                    Заказ {chat.context_order_id}
                                </span>
                            </div>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
