'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ChatList from './ChatList';
import MessageView from './MessageView';
import CreateChatModal from './CreateChatModal';
import PushPresenceBridge from './PushPresenceBridge';
import PushNotificationsCard from './PushNotificationsCard';
import type { MessengerChat, MessengerParticipant } from './types';
import { supabaseBrowser } from '@/utils/supabase-browser';
import { useAuth } from '@/components/auth/AuthProvider';

function getChatDisplayName(chat: MessengerChat | undefined, currentUserId?: number) {
    if (!chat) {
        return undefined;
    }

    if (chat.type !== 'direct') {
        return chat.name || 'Чат';
    }

    const otherParticipant = chat.chat_participants?.find((participant: MessengerParticipant) => participant.user_id !== currentUserId);
    const firstName = otherParticipant?.managers?.first_name || '';
    const lastName = otherParticipant?.managers?.last_name || '';
    const fullName = `${firstName} ${lastName}`.trim();

    return fullName || chat.name || 'Личный чат';
}

export default function MessengerPanel() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const [chats, setChats] = useState<MessengerChat[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [chatFilter, setChatFilter] = useState<'all' | 'direct' | 'group'>('all');
    const [chatsError, setChatsError] = useState<string | null>(null);
    const { user: currentUser } = useAuth();
    const highlightedMessageId = searchParams.get('message_id');

    useEffect(() => {
        const chatIdFromUrl = searchParams.get('chat_id');
        if (chatIdFromUrl) {
            setSelectedChatId(chatIdFromUrl);
        }
    }, [searchParams]);

    useEffect(() => {
        fetchChats();
        if (!supabaseBrowser.isConfigured) {
            return;
        }

        // Realtime subscription for chat updates (new messages, etc.)
        const channel = supabaseBrowser
            .channel('messenger-panel-updates')
            ?.on('postgres_changes', { 
                event: '*', 
                schema: 'public', 
                table: 'chats' 
            }, () => {
                fetchChats();
            })
            ?.on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'messages' 
            }, () => {
                fetchChats();
            })
            ?.subscribe();

        return () => {
            supabaseBrowser.removeChannel(channel);
        };
    }, []);

    const fetchChats = async () => {
        setChatsError(null);
        try {
            const res = await fetch('/api/messenger/chats');
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.error || 'Не удалось загрузить список чатов');
            }
            const data = await res.json();
            if (Array.isArray(data)) {
                setChats(data as MessengerChat[]);
            }
        } catch (error) {
            console.error('Failed to fetch chats:', error);
            setChatsError(error instanceof Error ? error.message : 'Не удалось загрузить список чатов');
        } finally {
            setLoading(false);
        }
    };

    const handleChatCreated = (chatId: string) => {
        setSelectedChatId(chatId);
        router.replace(`/messenger?chat_id=${encodeURIComponent(chatId)}`, { scroll: false });
        setIsCreateModalOpen(false);
        fetchChats();
    };

    const handleLeftChat = () => {
        setSelectedChatId(null);
        router.replace('/messenger', { scroll: false });
        fetchChats();
    };

    const handleDeletedChat = () => {
        setSelectedChatId(null);
        router.replace('/messenger', { scroll: false });
        fetchChats();
    };

    const handleSelectChat = (chatId: string) => {
        setSelectedChatId(chatId);
        router.replace(`/messenger?chat_id=${encodeURIComponent(chatId)}`, { scroll: false });
    };

    const currentChat = chats.find((chat) => chat.id === selectedChatId);
    const currentUserId = currentUser?.retail_crm_manager_id ?? undefined;
    const currentChatName = getChatDisplayName(currentChat, currentUserId);
    const isChatOpen = Boolean(selectedChatId);
    const filteredChats = chats.filter((chat) => {
        if (chatFilter !== 'all' && chat.type !== chatFilter) {
            return false;
        }

        const displayName = getChatDisplayName(chat, currentUserId) || '';
        const lastMessage = chat.last_message?.content || '';
        const orderLabel = chat.context_order_id ? String(chat.context_order_id) : '';
        const query = search.trim().toLowerCase();

        if (!query) {
            return true;
        }

        return [displayName, lastMessage, orderLabel].some((value) => value.toLowerCase().includes(query));
    });

    return (
        <div className="grid gap-0 md:gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <PushPresenceBridge selectedChatId={selectedChatId} />
            <div className="relative w-full overflow-hidden rounded-none border-y border-slate-200 bg-[#eef3f8] shadow-none md:rounded-[28px] md:border md:bg-white md:shadow-lg md:shadow-slate-200/60">
            <div className="flex h-[calc(100dvh-8rem)] min-h-[calc(100dvh-8rem)] flex-col md:h-[680px] md:min-h-[560px] md:max-h-[820px] md:flex-row">
            {/* Sidebar / Chat List */}
            <div className={`${isChatOpen ? 'hidden md:flex' : 'flex'} w-full flex-col bg-[#eef3f8] md:w-[360px] md:min-w-[360px] md:border-r md:border-slate-200 md:bg-[#f8fbff]`}>
                <div className="border-b border-slate-200 bg-white/90 px-4 pb-4 pt-4 backdrop-blur-sm md:px-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-[22px] font-bold tracking-tight text-slate-900">Чаты</div>
                            <div className="text-xs text-slate-400">Корпоративный мессенджер</div>
                        </div>
                        <button 
                        className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-500 text-white shadow-lg shadow-sky-200 transition hover:bg-sky-600"
                        onClick={() => setIsCreateModalOpen(true)}
                        title="Создать чат"
                    >
                        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                    </button>
                    </div>

                    <div className="mt-4">
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Поиск"
                            className="w-full rounded-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                        />
                    </div>

                    <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
                        {[
                            { value: 'all', label: 'Все' },
                            { value: 'group', label: 'Группы' },
                            { value: 'direct', label: 'Личные' },
                        ].map((filterOption) => (
                            <button
                                key={filterOption.value}
                                type="button"
                                onClick={() => setChatFilter(filterOption.value as 'all' | 'direct' | 'group')}
                                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                                    chatFilter === filterOption.value
                                        ? 'bg-slate-900 text-white shadow-sm'
                                        : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50'
                                }`}
                            >
                                {filterOption.label}
                            </button>
                        ))}
                    </div>
                </div>
                
                <div className="no-scrollbar flex-1 overflow-y-auto pb-4 pt-2">
                    {loading ? (
                        <div className="p-6 text-center text-sm text-slate-500">Загрузка...</div>
                    ) : chatsError ? (
                        <div className="m-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                            <p className="font-semibold">Не удалось загрузить чаты</p>
                            <p className="mt-1 text-red-600">{chatsError}</p>
                            <button
                                type="button"
                                onClick={fetchChats}
                                className="mt-3 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-700"
                            >
                                Повторить
                            </button>
                        </div>
                    ) : (
                        <ChatList 
                            chats={filteredChats} 
                            selectedId={selectedChatId} 
                            currentUserId={currentUserId}
                            onSelect={handleSelectChat} 
                        />
                    )}
                </div>
            </div>

            {/* Main Window / Message View */}
            <div className={`${isChatOpen ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col bg-white`}>
                {selectedChatId ? (
                    <MessageView 
                        chatId={selectedChatId} 
                        highlightedMessageId={highlightedMessageId}
                        currentUserId={currentUserId}
                        chatName={currentChatName}
                        participants={currentChat?.chat_participants}
                        chatType={currentChat?.type}
                        contextOrder={currentChat?.context_order}
                        onBack={handleLeftChat}
                        onLeftChat={handleLeftChat}
                        onDeletedChat={handleDeletedChat}
                        onMembersChanged={fetchChats}
                    />
                ) : (
                    <div className="flex flex-1 flex-col items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.45),_transparent_35%),linear-gradient(180deg,_#f8fbff_0%,_#ffffff_26%)] p-8 text-center text-slate-400">
                        <div className="mb-4 rounded-full bg-white p-6 shadow-sm ring-1 ring-slate-200">
                            <svg className="h-16 w-16 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                            </svg>
                        </div>
                        <p className="text-lg font-medium text-slate-700">Выберите чат, чтобы начать общение</p>
                        <p className="text-sm text-slate-400">Используйте поиск или создайте новый диалог</p>
                    </div>
                )}
            </div>

            {/* Modal */}
            {isCreateModalOpen && (
                <CreateChatModal 
                    onClose={() => setIsCreateModalOpen(false)} 
                    onCreated={handleChatCreated}
                />
            )}
            </div>
            </div>

            <div className="hidden space-y-4 xl:block">
                <PushNotificationsCard selectedChatId={selectedChatId} selectedChatType={currentChat?.type} />
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="text-sm font-semibold text-slate-900">Статус канала</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">
                        Push v1 уже умеет регистрировать browser subscription, сохранять её на сервере, выбирать один основной endpoint на пользователя и подавлять уведомления, если нужный чат уже открыт в активной вкладке или на активном устройстве.
                    </div>
                </div>
            </div>
        </div>
    );
}
