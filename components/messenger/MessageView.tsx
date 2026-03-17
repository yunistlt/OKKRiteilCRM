'use client';

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/utils/supabase';
import MessageInput from './MessageInput';

interface MessageViewProps {
    chatId: string;
}

export default function MessageView({ chatId }: MessageViewProps) {
    const [messages, setMessages] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetchMessages();

        // Subscribe to real-time messages for this specific chat
        const channel = supabase
            .channel(`chat:${chatId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `chat_id=eq.${chatId}`
            }, (payload) => {
                setMessages(prev => [payload.new, ...prev]);
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
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
            }
        } catch (error) {
            console.error('Failed to fetch messages:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-white">
            {/* Header */}
            <div className="p-4 border-b flex items-center justify-between bg-gray-50/50 backdrop-blur-sm sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
                        C
                    </div>
                    <div>
                        <h3 className="font-semibold text-gray-900 leading-none">Чат</h3>
                        <span className="text-xs text-green-500 font-medium tracking-wide">● В сети</span>
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
                        
                        return (
                            <div 
                                key={msg.id} 
                                className={`flex ${isSystem ? 'justify-center' : 'justify-start'} group max-w-[85%]`}
                            >
                                <div className={`
                                    py-2.5 px-4 rounded-2xl shadow-sm
                                    ${isSystem 
                                        ? 'bg-amber-50 text-amber-800 text-xs font-medium border border-amber-100 rounded-lg' 
                                        : 'bg-white text-gray-800 border border-gray-100 rounded-bl-sm'
                                    }
                                `}>
                                    {msg.content && <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>}
                                    
                                    {msg.attachments && msg.attachments.length > 0 && (
                                        <div className="mt-2 flex flex-col gap-1.5">
                                            {msg.attachments.map((att: any, idx: number) => (
                                                <a 
                                                    key={idx}
                                                    href={att.url} 
                                                    target="_blank" 
                                                    rel="noreferrer"
                                                    className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg border border-gray-100 hover:bg-gray-100 transition-colors group"
                                                >
                                                    <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                                    </svg>
                                                    <span className="text-xs font-medium text-gray-700 truncate max-w-[150px]">
                                                        {att.name || 'Файл'}
                                                    </span>
                                                </a>
                                            ))}
                                        </div>
                                    )}
                                    
                                    {!isSystem && (
                                        <div className="flex justify-end mt-1">
                                            <span className="text-[9px] text-gray-400 font-medium">
                                                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Input Area */}
            <MessageInput chatId={chatId} />
        </div>
    );
}
