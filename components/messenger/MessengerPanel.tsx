'use client';

import React, { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import ChatList from './ChatList';
import MessageView from './MessageView';
import CreateChatModal from './CreateChatModal';
import PushPresenceBridge from './PushPresenceBridge';
import PushNotificationsCard from './PushNotificationsCard';
import { getChatAvatarUrl, getChatDisplayName } from './chat-identity';
import type { MessengerChat, MessengerParticipant } from './types';
import { supabaseBrowser } from '@/utils/supabase-browser';
import { useAuth } from '@/components/auth/AuthProvider';

export default function MessengerPanel() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const [chats, setChats] = useState<MessengerChat[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [chatFilter, setChatFilter] = useState<'all' | 'unread' | 'direct' | 'group'>('all');
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
    const currentChatAvatarUrl = getChatAvatarUrl(currentChat, currentUserId);
    const isChatOpen = Boolean(selectedChatId);
    const totalUnread = chats.reduce((sum, chat) => sum + (chat.unread_count || 0), 0);
    const directChatsCount = chats.filter((chat) => chat.type === 'direct').length;
    const groupChatsCount = chats.filter((chat) => chat.type === 'group').length;
    const unreadChatsCount = chats.filter((chat) => (chat.unread_count || 0) > 0).length;
    const filteredChats = chats.filter((chat) => {
        if (chatFilter === 'unread' && (chat.unread_count || 0) === 0) {
            return false;
        }

        if (chatFilter !== 'all' && chatFilter !== 'unread' && chat.type !== chatFilter) {
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

    const openMobileSidebar = () => {
        window.dispatchEvent(new Event('open-mobile-sidebar'));
    };

    return (
        <div className="grid h-full min-h-0 gap-0 md:gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <PushPresenceBridge selectedChatId={selectedChatId} />
            <div className="relative h-full min-h-0 w-full overflow-hidden rounded-none border-y border-slate-200 bg-[#eef3f8] shadow-none md:rounded-[28px] md:border md:bg-white md:shadow-lg md:shadow-slate-200/60">
            <div className="flex h-full min-h-0 flex-col md:h-[680px] md:min-h-[560px] md:max-h-[820px] md:flex-row">
            {/* Sidebar / Chat List */}
            <div className={`${isChatOpen ? 'hidden md:flex' : 'flex'} w-full flex-col bg-[#eef3f8] md:w-[360px] md:min-w-[360px] md:border-r md:border-slate-200 md:bg-[#f8fbff]`}>
                <div className="border-b border-slate-200 bg-[linear-gradient(180deg,_rgba(255,255,255,0.98)_0%,_rgba(248,250,252,0.96)_100%)] px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.35rem)] md:hidden">
                    <div className="flex items-center justify-between gap-2">
                        <button
                            type="button"
                            onClick={openMobileSidebar}
                            className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-500 text-white shadow-lg shadow-sky-200 transition hover:bg-sky-600"
                            aria-label="Открыть меню"
                        >
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h16M4 17h16" />
                            </svg>
                        </button>

                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <div className="flex -space-x-1.5">
                                    <Link href="/settings/profile" className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-sky-500 text-[11px] font-bold text-white shadow-sm overflow-hidden">
                                        {(currentUser?.username || 'U').slice(0, 2).toUpperCase()}
                                    </Link>
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-[11px] font-bold text-white shadow-sm">
                                        {String(unreadChatsCount || 0).padStart(2, '0')}
                                    </div>
                                </div>
                                <div className="min-w-0">
                                    <div className="truncate text-[18px] font-bold tracking-tight text-slate-900">Чаты</div>
                                    <div className="truncate text-[10px] font-medium leading-tight text-slate-400">
                                        {currentUser?.username || 'Менеджер'} • {totalUnread > 0 ? `${totalUnread} новых` : 'всё прочитано'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => searchInputRef.current?.focus()}
                                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50"
                                aria-label="Поиск"
                            >
                                <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0Z" />
                                </svg>
                            </button>
                            <button 
                                className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-500 text-white shadow-lg shadow-sky-200 transition hover:bg-sky-600"
                                onClick={() => setIsCreateModalOpen(true)}
                                title="Создать чат"
                                aria-label="Создать чат"
                            >
                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="border-b border-slate-200 bg-white/90 px-4 pb-3 pt-3 backdrop-blur-sm md:px-5 md:pb-4 md:pt-4">
                    <div className="hidden items-center justify-between md:flex">
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

                    <div className="mt-0 md:mt-4">
                        <input
                            ref={searchInputRef}
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Поиск"
                            className="w-full rounded-full border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700 outline-none transition focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-100"
                        />
                    </div>

                    <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
                        {[
                            { value: 'all', label: 'Все' },
                            { value: 'unread', label: 'Новые' },
                            { value: 'group', label: 'Группы' },
                            { value: 'direct', label: 'Личные' },
                        ].map((filterOption) => (
                            <button
                                key={filterOption.value}
                                type="button"
                                onClick={() => setChatFilter(filterOption.value as 'all' | 'unread' | 'direct' | 'group')}
                                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                                    chatFilter === filterOption.value
                                        ? 'bg-slate-900 text-white shadow-sm'
                                        : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50'
                                }`}
                            >
                                {filterOption.label}
                            </button>
                        ))}
                    </div>

                    <div className="mt-3 hidden items-center gap-2 overflow-x-auto no-scrollbar md:hidden">
                        <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                            Всего {chats.length}
                        </span>
                        <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                            Личные {directChatsCount}
                        </span>
                        <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                            Группы {groupChatsCount}
                        </span>
                    </div>
                </div>
                
                <div className="no-scrollbar flex-1 overflow-y-auto px-0 pb-4 pt-2 md:px-0 md:pb-4">
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
                        chatAvatarUrl={currentChatAvatarUrl}
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
