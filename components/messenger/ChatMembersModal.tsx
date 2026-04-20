'use client';

import React, { useState, useEffect } from 'react';

interface Member {
    user_id: number;
    role: string;
    managers: {
        id: number;
        first_name: string;
        last_name: string;
        username: string;
    } | null;
}

interface Manager {
    id: number;
    first_name: string;
    last_name: string;
    username: string;
}

interface ChatMembersModalProps {
    chatId: string;
    chatType?: string;
    chatName?: string;
    currentUserId?: number;
    onClose: () => void;
    onMembersChanged?: () => void;
    onLeftChat?: () => void;
    onDeletedChat?: () => void;
}

export default function ChatMembersModal({ chatId, chatType, chatName, currentUserId, onClose, onMembersChanged, onLeftChat, onDeletedChat }: ChatMembersModalProps) {
    const [members, setMembers] = useState<Member[]>([]);
    const [myRole, setMyRole] = useState<string>('member');
    const [allManagers, setAllManagers] = useState<Manager[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [tab, setTab] = useState<'current' | 'add'>('current');
    const [processing, setProcessing] = useState<number | null>(null);
    const [groupName, setGroupName] = useState(chatName || '');
    const [renaming, setRenaming] = useState(false);

    useEffect(() => {
        fetchMembers();
        fetchManagers();
    }, [chatId]);

    useEffect(() => {
        setGroupName(chatName || '');
    }, [chatName]);

    const fetchMembers = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/messenger/chats/members?chat_id=${chatId}`);
            const data = await res.json();
            if (data.members) {
                setMembers(data.members);
                setMyRole(data.myRole || 'member');
            }
        } catch (err) {
            console.error('Failed to fetch members:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchManagers = async () => {
        try {
            const res = await fetch('/api/managers');
            const data = await res.json();
            if (Array.isArray(data)) setAllManagers(data);
        } catch (err) {
            console.error('Failed to fetch managers:', err);
        }
    };

    const handleRemove = async (userId: number) => {
        if (processing) return;
        setProcessing(userId);
        try {
            const res = await fetch('/api/messenger/chats/members', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, user_id: userId })
            });
            if (res.ok) {
                setMembers(prev => prev.filter(m => m.user_id !== userId));
                onMembersChanged?.();
            } else {
                const data = await res.json();
                alert(data.error || 'Ошибка при удалении');
            }
        } catch (err) {
            console.error('Failed to remove member:', err);
        } finally {
            setProcessing(null);
        }
    };

    const handleAdd = async (userId: number) => {
        if (processing) return;
        setProcessing(userId);
        try {
            const res = await fetch('/api/messenger/chats/members', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, user_id: userId })
            });
            if (res.ok) {
                await fetchMembers();
                onMembersChanged?.();
                setTab('current');
            } else {
                const data = await res.json();
                alert(data.error || 'Ошибка при добавлении');
            }
        } catch (err) {
            console.error('Failed to add member:', err);
        } finally {
            setProcessing(null);
        }
    };

    const isAdmin = myRole === 'admin';
    const canLeaveGroup = chatType === 'group' && typeof currentUserId === 'number';
    const canRenameGroup = chatType === 'group' && isAdmin;
    const canDeleteGroup = chatType === 'group' && isAdmin;
    const memberIds = new Set(members.map(m => m.user_id));

    // Non-members available to add
    const nonMembers = allManagers.filter(m => !memberIds.has(m.id));

    const filteredMembers = members.filter(m => {
        const name = `${m.managers?.first_name || ''} ${m.managers?.last_name || ''} ${m.managers?.username || ''}`.toLowerCase();
        return name.includes(search.toLowerCase());
    });

    const filteredNonMembers = nonMembers.filter(m => {
        const name = `${m.first_name} ${m.last_name} ${m.username}`.toLowerCase();
        return name.includes(search.toLowerCase());
    });

    const getInitials = (first?: string | null, last?: string | null) => {
        return `${first?.[0] || ''}${last?.[0] || ''}`.toUpperCase() || '?';
    };

    const ROLE_COLORS: Record<string, string> = {
        admin: '#1c7ed6',
        member: '#868e96'
    };

    const ROLE_LABELS: Record<string, string> = {
        admin: 'Админ',
        member: 'Участник'
    };

    const handleLeaveChat = async () => {
        if (!currentUserId || processing) return;

        const confirmed = window.confirm('Выйти из группового чата?');
        if (!confirmed) return;

        setProcessing(currentUserId);
        try {
            const res = await fetch('/api/messenger/chats/members', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, user_id: currentUserId })
            });

            if (!res.ok) {
                const data = await res.json();
                alert(data.error || 'Ошибка при выходе из чата');
                return;
            }

            onMembersChanged?.();
            onLeftChat?.();
            onClose();
        } catch (err) {
            console.error('Failed to leave chat:', err);
            alert('Ошибка при выходе из чата');
        } finally {
            setProcessing(null);
        }
    };

    const handleRenameChat = async () => {
        const normalizedName = groupName.trim();
        if (!canRenameGroup || renaming) return;
        if (normalizedName.length < 2) {
            alert('Название группы должно быть не короче 2 символов');
            return;
        }

        setRenaming(true);
        try {
            const res = await fetch('/api/messenger/chats', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, name: normalizedName })
            });

            if (!res.ok) {
                const data = await res.json();
                alert(data.error || 'Ошибка при переименовании');
                return;
            }

            onMembersChanged?.();
        } catch (err) {
            console.error('Failed to rename chat:', err);
            alert('Ошибка при переименовании');
        } finally {
            setRenaming(false);
        }
    };

    const handleDeleteChat = async () => {
        if (!canDeleteGroup || processing) return;

        const confirmed = window.confirm('Удалить групповой чат целиком? Это действие удалит переписку и участников из этого чата.');
        if (!confirmed) return;

        setProcessing(-1);
        try {
            const res = await fetch('/api/messenger/chats', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId })
            });

            if (!res.ok) {
                const data = await res.json();
                alert(data.error || 'Ошибка при удалении чата');
                return;
            }

            onMembersChanged?.();
            onDeletedChat?.();
            onClose();
        } catch (err) {
            console.error('Failed to delete chat:', err);
            alert('Ошибка при удалении чата');
        } finally {
            setProcessing(null);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[200] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="flex h-[92dvh] max-h-[92dvh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-[28px] border border-slate-200 bg-white shadow-2xl shadow-slate-900/20 sm:h-auto sm:max-h-[85vh] sm:rounded-[28px]">
                <div className="border-b border-slate-200 bg-slate-50 px-4 pb-4 pt-4 sm:px-5 sm:pt-5">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h2 className="m-0 text-lg font-semibold text-slate-900">Участники чата</h2>
                            <p className="mt-1 text-sm text-slate-500">
                                {members.length} {members.length === 1 ? 'участник' : members.length < 5 ? 'участника' : 'участников'}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                        >
                            ✕
                        </button>
                    </div>

                    {isAdmin && (
                        <div className="mt-4 flex gap-2 rounded-2xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
                            {(['current', 'add'] as const).map((currentTab) => (
                                <button
                                    key={currentTab}
                                    onClick={() => setTab(currentTab)}
                                    className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition sm:text-sm ${
                                        tab === currentTab
                                            ? 'bg-slate-900 text-white shadow-sm'
                                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                                    }`}
                                >
                                    {currentTab === 'current' ? 'Текущие' : 'Добавить'}
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="mt-4">
                        <input
                            type="text"
                            placeholder="Поиск"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                        />
                    </div>

                    {canRenameGroup && (
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                            <input
                                type="text"
                                value={groupName}
                                onChange={(e) => setGroupName(e.target.value)}
                                placeholder="Название группы"
                                className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
                            />
                            <button
                                onClick={handleRenameChat}
                                disabled={renaming || groupName.trim() === (chatName || '').trim()}
                                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-default disabled:bg-slate-300 sm:py-0"
                            >
                                {renaming ? '...' : 'Сохранить'}
                            </button>
                        </div>
                    )}

                    <div className="mt-3 flex flex-col gap-2">
                        {canLeaveGroup && (
                            <button
                                onClick={handleLeaveChat}
                                disabled={!!processing}
                                className="w-full rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-default disabled:opacity-60"
                            >
                                {processing === currentUserId ? 'Выход...' : 'Выйти из чата'}
                            </button>
                        )}

                        {canDeleteGroup && (
                            <button
                                onClick={handleDeleteChat}
                                disabled={!!processing}
                                className="w-full rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-default disabled:opacity-60"
                            >
                                {processing === -1 ? 'Удаление...' : 'Удалить чат'}
                            </button>
                        )}
                    </div>
                </div>

                <div className="no-scrollbar flex-1 overflow-y-auto bg-white px-4 py-4 sm:px-5">
                    {loading ? (
                        <div className="pt-8 text-center text-sm text-slate-400">Загрузка...</div>
                    ) : tab === 'current' ? (
                        filteredMembers.length === 0 ? (
                            <div className="pt-8 text-center text-sm text-slate-400">Никого не найдено</div>
                        ) : (
                            <div className="flex flex-col gap-3">
                                {filteredMembers.map((member) => {
                                    const manager = member.managers;
                                    const isMe = member.user_id === currentUserId;
                                    const isRemoving = processing === member.user_id;

                                    return (
                                        <div
                                            key={member.user_id}
                                            className={`flex items-center gap-3 rounded-2xl border px-3 py-3 shadow-sm ${
                                                isMe
                                                    ? 'border-sky-200 bg-sky-50'
                                                    : 'border-slate-200 bg-slate-50'
                                            }`}
                                        >
                                            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-bold text-white">
                                                {getInitials(manager?.first_name, manager?.last_name)}
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-semibold text-slate-900">
                                                    {manager ? `${manager.first_name} ${manager.last_name}` : `ID: ${member.user_id}`}
                                                    {isMe && <span className="ml-2 text-xs font-medium text-sky-700">(вы)</span>}
                                                </div>
                                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                                    {manager?.username && <span>@{manager.username}</span>}
                                                    <span
                                                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                                                        style={{ background: ROLE_COLORS[member.role] || '#868e96' }}
                                                    >
                                                        {ROLE_LABELS[member.role] || member.role}
                                                    </span>
                                                </div>
                                            </div>

                                            {isAdmin && !isMe && (
                                                <button
                                                    onClick={() => handleRemove(member.user_id)}
                                                    disabled={!!processing}
                                                    title="Удалить из чата"
                                                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-600 transition hover:bg-rose-50 disabled:cursor-default disabled:opacity-50"
                                                >
                                                    {isRemoving ? '⏳' : '✕'}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    ) : filteredNonMembers.length === 0 ? (
                        <div className="pt-8 text-center text-sm text-slate-400">
                            {nonMembers.length === 0 ? 'Все менеджеры уже в чате' : 'Никого не найдено'}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {filteredNonMembers.map((manager) => {
                                const isAdding = processing === manager.id;

                                return (
                                    <button
                                        key={manager.id}
                                        onClick={() => handleAdd(manager.id)}
                                        disabled={!!processing}
                                        className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-left shadow-sm transition hover:border-sky-200 hover:bg-sky-50 disabled:cursor-default disabled:opacity-50"
                                    >
                                        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-white text-sm font-bold text-slate-500 ring-1 ring-slate-200">
                                            {getInitials(manager.first_name, manager.last_name)}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-semibold text-slate-900">
                                                {manager.first_name} {manager.last_name}
                                            </div>
                                            <div className="mt-1 text-xs text-slate-500">@{manager.username}</div>
                                        </div>
                                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-sky-100 text-lg font-bold text-sky-700">
                                            {isAdding ? '⏳' : '+'}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
