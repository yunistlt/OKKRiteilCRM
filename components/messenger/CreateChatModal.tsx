'use client';

import React, { useState, useEffect } from 'react';

interface Manager {
    id: number;
    first_name: string;
    last_name: string;
    username: string;
}

interface CreateChatModalProps {
    onClose: () => void;
    onCreated: (chatId: string) => void;
}

export default function CreateChatModal({ onClose, onCreated }: CreateChatModalProps) {
    const [managers, setManagers] = useState<Manager[]>([]);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [groupName, setGroupName] = useState('');
    const [contextOrderId, setContextOrderId] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [search, setSearch] = useState('');

    useEffect(() => {
        fetchManagers();
    }, []);

    const fetchManagers = async () => {
        try {
            const res = await fetch('/api/managers');
            const data = await res.json();
            if (Array.isArray(data)) {
                setManagers(data);
            }
        } catch (error) {
            console.error('Failed to fetch managers:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleManager = (id: number) => {
        setSelectedIds(prev => 
            prev.includes(id) 
                ? prev.filter(i => i !== id) 
                : [...prev, id]
        );
    };

    const handleCreate = async () => {
        if (selectedIds.length === 0) return;
        
        setCreating(true);
        try {
            const type = selectedIds.length > 1 ? 'group' : 'direct';
            const res = await fetch('/api/messenger/chats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type,
                    name: type === 'group' ? (groupName || 'Групповой чат') : null,
                    participant_ids: selectedIds,
                    context_order_id: contextOrderId ? parseInt(contextOrderId) : null
                })
            });

            const data = await res.json();

            if (res.ok && data.id) {
                onCreated(data.id);
            } else {
                alert(`Ошибка: ${data.error || 'Не удалось создать чат'}`);
            }
        } catch (error) {
            console.error('Failed to create chat:', error);
            alert('Ошибка при создании чата');
        } finally {
            setCreating(false);
        }
    };

    const filteredManagers = managers.filter(m => 
        `${m.first_name} ${m.last_name} ${m.username}`.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
                <div className="p-6 border-b flex justify-between items-center bg-gray-50 rounded-t-2xl">
                    <h2 className="text-xl font-bold text-gray-900">Новый чат</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-6 flex-1 overflow-y-auto flex flex-col gap-4">
                    {/* Search */}
                    <input 
                        type="text"
                        placeholder="Поиск сотрудников..."
                        className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />

                    {/* Group Name (if multi-select) */}
                    {selectedIds.length > 1 && (
                        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 ml-1">Название группы</label>
                            <input 
                                type="text"
                                placeholder="Например: Обсуждение заказа #123"
                                className="w-full p-3 bg-blue-50 border border-blue-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-blue-900"
                                value={groupName}
                                onChange={(e) => setGroupName(e.target.value)}
                            />
                        </div>
                    )}

                    {/* Order Context */}
                    <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 ml-1">Привязать к заказу (ID)</label>
                        <input 
                            type="number"
                            placeholder="Например: 51492 (необязательно)"
                            className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                            value={contextOrderId}
                            onChange={(e) => setContextOrderId(e.target.value)}
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 ml-1">Выберите участников ({selectedIds.length})</label>
                        {loading ? (
                            <div className="p-8 text-center text-gray-400 animate-pulse">Загрузка списка...</div>
                        ) : (
                            <div className="flex flex-col gap-1">
                                {filteredManagers.map((manager) => {
                                    const isSelected = selectedIds.includes(manager.id);
                                    return (
                                        <button
                                            key={manager.id}
                                            onClick={() => handleToggleManager(manager.id)}
                                            className={`flex items-center gap-3 p-3 rounded-xl transition-all border ${
                                                isSelected 
                                                    ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-200' 
                                                    : 'bg-white border-transparent hover:bg-gray-50 text-gray-700'
                                            }`}
                                        >
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                                                isSelected ? 'bg-white text-blue-600' : 'bg-gray-100 text-gray-400'
                                            }`}>
                                                {manager.first_name?.[0]}{manager.last_name?.[0]}
                                            </div>
                                            <div className="flex-1 text-left">
                                                <div className="font-semibold">{manager.first_name} {manager.last_name}</div>
                                                <div className={`text-[10px] ${isSelected ? 'text-blue-200' : 'text-gray-400'}`}>@{manager.username}</div>
                                            </div>
                                            {isSelected && (
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-6 border-t bg-gray-50 rounded-b-2xl">
                    <button
                        onClick={handleCreate}
                        disabled={selectedIds.length === 0 || creating}
                        className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold text-lg hover:bg-blue-700 disabled:opacity-50 disabled:bg-gray-300 transition-all shadow-xl shadow-blue-100 flex items-center justify-center gap-2"
                    >
                        {creating ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white border-t-transparent animate-spin rounded-full" />
                                Создание...
                            </>
                        ) : (
                            <>
                                {selectedIds.length > 1 ? 'Создать группу' : 'Начать диалог'}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
