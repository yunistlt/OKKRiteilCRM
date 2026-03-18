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

        const channel = supabaseBrowser
            .channel(`chat-${chatId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `chat_id=eq.${chatId}`
            }, (payload) => {
                console.log('[Realtime] New message received:', payload.new);
                setMessages(prev => [...prev, payload.new]);
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
                // API returns descending, reverse for chronological display
                setMessages([...data.messages].reverse());
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

    const formatTime = (dateStr: string) => {
        return new Date(dateStr).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    };

    // Group messages by date
    const groupedMessages = messages.reduce((acc: { date: string; msgs: any[] }[], msg) => {
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

    return (
        <div className="flex-1 flex flex-col h-full" style={{ background: '#eae6df' }}>
            {/* Header — Telegram style */}
            <div style={{
                background: '#fff',
                borderBottom: '1px solid #e0e0e0',
                padding: '10px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                position: 'sticky',
                top: 0,
                zIndex: 10
            }}>
                <div style={{
                    width: 42,
                    height: 42,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #4fa3e3, #1c7ed6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 18,
                    flexShrink: 0
                }}>
                    {chatName ? chatName[0].toUpperCase() : 'Ч'}
                </div>
                <div>
                    <div style={{ fontWeight: 600, fontSize: 15, color: '#000', lineHeight: 1.2 }}>
                        {chatName || 'Чат'}
                    </div>
                    <div style={{ fontSize: 12, color: '#4fa3e3', marginTop: 2 }}>
                        {participants ? `${participants.length} участников` : 'в сети'}
                    </div>
                </div>
            </div>

            {/* Messages Area */}
            <div
                ref={scrollRef}
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '12px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2
                }}
            >
                {loading ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                        Загрузка сообщений...
                    </div>
                ) : messages.length === 0 ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#aaa' }}>
                        <div style={{
                            background: 'rgba(0,0,0,0.3)',
                            color: '#fff',
                            borderRadius: 12,
                            padding: '6px 16px',
                            fontSize: 13
                        }}>
                            Нет сообщений. Напишите первым!
                        </div>
                    </div>
                ) : (
                    groupedMessages.map((group) => (
                        <React.Fragment key={group.date}>
                            {/* Date divider */}
                            <div style={{
                                display: 'flex',
                                justifyContent: 'center',
                                margin: '8px 0'
                            }}>
                                <span style={{
                                    background: 'rgba(0,0,0,0.28)',
                                    color: '#fff',
                                    borderRadius: 10,
                                    padding: '3px 10px',
                                    fontSize: 12,
                                    fontWeight: 500
                                }}>
                                    {group.date}
                                </span>
                            </div>

                            {group.msgs.map((msg, idx) => {
                                const isSystem = msg.sender_id === null;
                                const isMine = msg.sender_id === currentUserId;

                                // Read status
                                const otherParticipants = participants?.filter(p => p.user_id !== currentUserId) || [];
                                const latestReadAt = otherParticipants.length > 0
                                    ? Math.max(...otherParticipants.map(p => new Date(p.last_read_at).getTime()))
                                    : 0;
                                const isRead = new Date(msg.created_at).getTime() <= latestReadAt;

                                // Show sender name only if changed from previous
                                const prevMsg = group.msgs[idx - 1];
                                const showSenderName = !isMine && !isSystem && msg.sender_id !== prevMsg?.sender_id;

                                if (isSystem) {
                                    return (
                                        <div key={msg.id} style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
                                            <span style={{
                                                background: 'rgba(0,0,0,0.28)',
                                                color: '#fff',
                                                borderRadius: 10,
                                                padding: '3px 12px',
                                                fontSize: 12
                                            }}>
                                                {msg.content}
                                            </span>
                                        </div>
                                    );
                                }

                                return (
                                    <div key={msg.id} style={{
                                        display: 'flex',
                                        justifyContent: isMine ? 'flex-end' : 'flex-start',
                                        marginBottom: 2,
                                        paddingLeft: isMine ? '15%' : 0,
                                        paddingRight: isMine ? 0 : '15%',
                                    }}>
                                        <div style={{ maxWidth: '100%', display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start' }}>
                                            {/* Sender name for group chats */}
                                            {showSenderName && (
                                                <span style={{
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                    color: '#1c7ed6',
                                                    marginBottom: 2,
                                                    marginLeft: 10,
                                                }}>
                                                    {participants?.find(p => p.user_id === msg.sender_id)?.managers?.first_name || 'Сотрудник'}
                                                </span>
                                            )}

                                            {/* Bubble */}
                                            <div style={{
                                                position: 'relative',
                                                // Telegram outgoing: #dcf8c6 (light green), incoming: #fff
                                                background: isMine ? '#dcf8c6' : '#ffffff',
                                                color: '#111',
                                                borderRadius: isMine
                                                    ? '12px 12px 4px 12px'
                                                    : '12px 12px 12px 4px',
                                                padding: '6px 10px 4px 10px',
                                                boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                                                fontSize: 14,
                                                lineHeight: 1.45,
                                                wordBreak: 'break-word'
                                            }}>
                                                {/* Message text */}
                                                {msg.content && (
                                                    <p style={{ margin: 0, paddingRight: 44, whiteSpace: 'pre-wrap' }}>
                                                        {msg.content}
                                                    </p>
                                                )}

                                                {/* Attachments */}
                                                {msg.attachments && msg.attachments.length > 0 && (
                                                    <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                        {msg.attachments.map((att: any, i: number) => (
                                                            <a
                                                                key={i}
                                                                href={att.url}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: 6,
                                                                    padding: '4px 8px',
                                                                    background: isMine ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.04)',
                                                                    borderRadius: 8,
                                                                    textDecoration: 'none',
                                                                    color: '#1c7ed6',
                                                                    fontSize: 13,
                                                                    fontWeight: 500
                                                                }}
                                                            >
                                                                📎 {att.name || 'Файл'}
                                                            </a>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Time + read status — bottom right inside bubble */}
                                                <div style={{
                                                    position: 'absolute',
                                                    bottom: 4,
                                                    right: 8,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 2,
                                                }}>
                                                    <span style={{ fontSize: 11, color: '#7d8b92', whiteSpace: 'nowrap' }}>
                                                        {formatTime(msg.created_at)}
                                                    </span>
                                                    {isMine && (
                                                        <span style={{ fontSize: 13, color: isRead ? '#4fa3e3' : '#aaa', lineHeight: 1 }}>
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
                    ))
                )}
            </div>

            {/* Input */}
            <MessageInput chatId={chatId} onMessageSent={fetchMessages} />
        </div>
    );
}
