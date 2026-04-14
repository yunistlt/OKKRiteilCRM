'use client';

import React, { useState, useEffect } from 'react';
import ChatList from './ChatList';
import MessageView from './MessageView';
import CreateChatModal from './CreateChatModal';
import { supabaseBrowser } from '@/utils/supabase-browser';
import { useAuth } from '@/components/auth/AuthProvider';

export default function MessengerPanel() {
    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const [chats, setChats] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const { user: currentUser } = useAuth();

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
        try {
            const res = await fetch('/api/messenger/chats');
            const data = await res.json();
            if (Array.isArray(data)) {
                setChats(data);
            }
        } catch (error) {
            console.error('Failed to fetch chats:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleChatCreated = (chatId: string) => {
        setSelectedChatId(chatId);
        setIsCreateModalOpen(false);
        fetchChats();
    };

    const currentChat = chats.find(c => c.id === selectedChatId);

    return (
        <div className="flex h-[600px] w-full bg-white border rounded-lg overflow-hidden shadow-lg relative">
            {/* Sidebar / Chat List */}
            <div className="w-1/3 border-r flex flex-col bg-gray-50">
                <div className="p-4 border-b bg-white flex justify-between items-center">
                    <h2 className="font-bold text-lg text-gray-800">Чаты</h2>
                    <button 
                        className="p-1 hover:bg-gray-100 rounded-full text-blue-600 transition-colors"
                        onClick={() => setIsCreateModalOpen(true)}
                        title="Создать чат"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                    </button>
                </div>
                
                <div className="overflow-y-auto flex-1">
                    {loading ? (
                        <div className="p-4 text-center text-gray-500">Загрузка...</div>
                    ) : (
                        <ChatList 
                            chats={chats} 
                            selectedId={selectedChatId} 
                            onSelect={setSelectedChatId} 
                        />
                    )}
                </div>
            </div>

            {/* Main Window / Message View */}
            <div className="flex-1 flex flex-col bg-white">
                {selectedChatId ? (
                    <MessageView 
                        chatId={selectedChatId} 
                        currentUserId={currentUser?.retail_crm_manager_id ?? undefined}
                        chatName={currentChat?.name}
                        participants={currentChat?.chat_participants}
                        chatType={currentChat?.type}
                        onMembersChanged={fetchChats}
                    />
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8 text-center">
                        <div className="mb-4 p-6 bg-gray-50 rounded-full">
                            <svg className="w-16 h-16 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                            </svg>
                        </div>
                        <p className="text-lg font-medium">Выберите чат, чтобы начать общение</p>
                        <p className="text-sm">Используйте поиск или создайте новый диалог</p>
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
    );
}
