'use client';

import React, { useState, useEffect, useRef } from 'react';
import { supabaseBrowser } from '@/utils/supabase-browser';
import MessageInput from './MessageInput';

interface MessageViewProps {
    chatId: string;
    currentUserId?: number;
    chatName?: string;
    participants?: any[];
}

export default function MessageView({ chatId, currentUserId, chatName, participants }: MessageViewProps) {
    const [messages, setMessages] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetchMessages();

        // Subscribe to real-time messages for this specific chat
        const channel = supabaseBrowser
            .channel(`chat-${chatId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `chat_id=eq.${chatId}`
            }, (payload) => {
                console.log('[Realtime] New message received:', payload.new);
                setMessages(prev => [payload.new, ...prev]);
            })
            .subscribe((status) => {
                console.log('[Realtime] Subscription status:', status);
            });

        return () => {
            supabaseBrowser.removeChannel(channel);
        };
    }, [chatId]);

    useEffect(() => {
        // Scroll to bottom when messages change
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const fetchMessages = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/messenger/messages?chat_id=${chatId}`);
            const data = await res.json();
            if (data.messages) {
                // Reverse because we fetch descending created_at
                setMessages(data.messages);
                markMessagesAsRead();
            }
        } catch (error) {
            console.error('Failed to fetch messages:', error);
        } finally {
            setLoading(false);
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

    return (
        <div className="flex-1 flex flex-col h-full bg-white">
            {/* Header */}
            <div className="p-4 border-b flex items-center justify-between bg-gray-50/50 backdrop-blur-sm sticky top-0 z-10 transition-all duration-300">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold shadow-md">
                        {chatName ? chatName[0].toUpperCase() : 'C'}
                    </div>
                    <div>
                        <h3 className="font-semibold text-gray-900 leading-none mb-1">
                            {chatName || 'Чат'}
                        </h3>
                        <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                            <span className="text-[10px] text-gray-500 font-medium">
                                {participants ? `${participants.length} участников` : 'В сети'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Messages Area */}
            <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 flex flex-col-reverse gap-4 bg-gray-50/30"
            >
                {loading ? (
                    <div className="flex-1 flex items-center justify-center text-gray-400">
                        Загрузка сообщений...
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-300 py-12">
                         <p className="text-sm">Нет сообщений. Напишите первым!</p>
                    </div>
                ) : (
                    messages.map((msg) => {
                        const isSystem = msg.sender_id === null;
                        const isMine = msg.sender_id === currentUserId;
                        
                        // Logic for read status
                        const otherParticipants = participants?.filter(p => p.user_id !== currentUserId) || [];
                        const latestReadAt = otherParticipants.length > 0 
                            ? Math.max(...otherParticipants.map(p => new Date(p.last_read_at).getTime()))
                            : 0;
                        const isRead = new Date(msg.created_at).getTime() <= latestReadAt;

                        return (
                            <div 
                                key={msg.id} 
                                className={`flex w-full ${isSystem ? 'justify-center' : isMine ? 'justify-end' : 'justify-start'}`}
                            >
                                <div className={`
                                    py-2 px-4 rounded-2xl shadow-sm max-w-[85%] group relative
                                    ${isSystem 
                                        ? 'bg-amber-50 text-amber-800 text-xs font-medium border border-amber-100 rounded-lg' 
                                        : isMine
                                            ? 'bg-blue-600 text-white rounded-br-sm'
                                            : 'bg-white text-gray-800 border border-gray-100 rounded-bl-sm'
                                    }
                                `}>
                                    {!isSystem && !isMine && (
                                        <div className="text-[10px] font-bold text-blue-500 mb-1 opacity-70">
                                            {participants?.find(p => p.user_id === msg.sender_id)?.managers?.first_name || 'Сотрудник'}
                                        </div>
                                    )}

                                    {msg.content && <p className="whitespace-pre-wrap leading-tight text-sm">{msg.content}</p>}
                                    
                                    {msg.attachments && msg.attachments.length > 0 && (
                                        <div className="mt-2 flex flex-col gap-1.5">
                                            {msg.attachments.map((att: any, idx: number) => (
                                                <a 
                                                    key={idx}
                                                    href={att.url} 
                                                    target="_blank" 
                                                    rel="noreferrer"
                                                    className={`flex items-center gap-2 p-2 rounded-lg border transition-colors group ${
                                                        isMine ? 'bg-blue-700/50 border-blue-500 hover:bg-blue-700' : 'bg-gray-50 border-gray-100 hover:bg-gray-100'
                                                    }`}
                                                >
                                                    <svg className={`w-4 h-4 ${isMine ? 'text-blue-200' : 'text-blue-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                                    </svg>
                                                    <span className={`text-xs font-medium truncate max-w-[150px] ${isMine ? 'text-blue-50' : 'text-gray-700'}`}>
                                                        {att.name || 'Файл'}
                                                    </span>
                                                </a>
                                            ))}
                                        </div>
                                    )}
                                    
                                    {!isSystem && (
                                        <div className="flex justify-end items-center gap-1 mt-1 opacity-70">
                                            <span className={`text-[9px] font-medium ${isMine ? 'text-blue-100' : 'text-gray-400'}`}>
                                                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                            {isMine && (
                                                <div className="flex">
                                                    {isRead ? (
                                                        <svg className="w-3 h-3 text-blue-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M20 6L9 17l-5-5"></path>
                                                            <path d="M12 17l11-11" className="opacity-70"></path>
                                                        </svg>
                                                    ) : (
                                                        <svg className="w-3 h-3 text-blue-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M20 6L9 17l-5-5"></path>
                                                        </svg>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Input Area */}
            <MessageInput chatId={chatId} onMessageSent={fetchMessages} />
        </div>
    );
}
