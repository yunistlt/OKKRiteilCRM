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
    currentUserId?: number;
    onClose: () => void;
    onMembersChanged?: () => void;
}

export default function ChatMembersModal({ chatId, currentUserId, onClose, onMembersChanged }: ChatMembersModalProps) {
    const [members, setMembers] = useState<Member[]>([]);
    const [myRole, setMyRole] = useState<string>('member');
    const [allManagers, setAllManagers] = useState<Manager[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [tab, setTab] = useState<'current' | 'add'>('current');
    const [processing, setProcessing] = useState<number | null>(null);

    useEffect(() => {
        fetchMembers();
        fetchManagers();
    }, [chatId]);

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

    return (
        <div
            style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', zIndex: 200, padding: 16
            }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div style={{
                background: '#fff', borderRadius: 20, width: '100%', maxWidth: 420,
                maxHeight: '85vh', display: 'flex', flexDirection: 'column',
                boxShadow: '0 25px 60px rgba(0,0,0,0.25)', overflow: 'hidden'
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px 20px 0', display: 'flex',
                    justifyContent: 'space-between', alignItems: 'center'
                }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111' }}>
                            Участники чата
                        </h2>
                        <p style={{ margin: '2px 0 0', fontSize: 13, color: '#868e96' }}>
                            {members.length} {members.length === 1 ? 'участник' : members.length < 5 ? 'участника' : 'участников'}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: '#f1f3f5', border: 'none', borderRadius: '50%',
                            width: 36, height: 36, cursor: 'pointer', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            color: '#495057', fontSize: 18, transition: 'background .15s'
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#e9ecef')}
                        onMouseLeave={e => (e.currentTarget.style.background = '#f1f3f5')}
                    >
                        ✕
                    </button>
                </div>

                {/* Tabs (only for admins) */}
                {isAdmin && (
                    <div style={{ display: 'flex', gap: 8, padding: '16px 20px 0' }}>
                        {(['current', 'add'] as const).map(t => (
                            <button
                                key={t}
                                onClick={() => setTab(t)}
                                style={{
                                    flex: 1, padding: '8px 0', borderRadius: 10, border: 'none',
                                    cursor: 'pointer', fontWeight: 600, fontSize: 13,
                                    background: tab === t ? '#1c7ed6' : '#f1f3f5',
                                    color: tab === t ? '#fff' : '#495057',
                                    transition: 'all .15s'
                                }}
                            >
                                {t === 'current' ? '👥 Текущие' : '➕ Добавить'}
                            </button>
                        ))}
                    </div>
                )}

                {/* Search */}
                <div style={{ padding: '12px 20px 0' }}>
                    <input
                        type="text"
                        placeholder="Поиск..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{
                            width: '100%', padding: '9px 14px', borderRadius: 12,
                            border: '1.5px solid #e9ecef', fontSize: 13, outline: 'none',
                            background: '#f8f9fa', boxSizing: 'border-box', color: '#212529',
                            transition: 'border-color .15s'
                        }}
                        onFocus={e => (e.currentTarget.style.borderColor = '#1c7ed6')}
                        onBlur={e => (e.currentTarget.style.borderColor = '#e9ecef')}
                    />
                </div>

                {/* List */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 20px' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', color: '#aaa', paddingTop: 32, fontSize: 14 }}>
                            Загрузка...
                        </div>
                    ) : tab === 'current' ? (
                        filteredMembers.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#aaa', paddingTop: 32, fontSize: 14 }}>
                                Никого не найдено
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {filteredMembers.map(member => {
                                    const m = member.managers;
                                    const isMe = member.user_id === currentUserId;
                                    const isRemoving = processing === member.user_id;
                                    return (
                                        <div key={member.user_id} style={{
                                            display: 'flex', alignItems: 'center', gap: 12,
                                            padding: '10px 12px', borderRadius: 12,
                                            background: isMe ? '#f0f7ff' : '#f8f9fa',
                                            border: isMe ? '1.5px solid #d0e8fb' : '1.5px solid transparent',
                                            transition: 'background .15s'
                                        }}>
                                            {/* Avatar */}
                                            <div style={{
                                                width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                                                background: 'linear-gradient(135deg, #4fa3e3, #1c7ed6)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                color: '#fff', fontWeight: 700, fontSize: 15
                                            }}>
                                                {getInitials(m?.first_name, m?.last_name)}
                                            </div>

                                            {/* Info */}
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontWeight: 600, fontSize: 14, color: '#212529' }}>
                                                    {m ? `${m.first_name} ${m.last_name}` : `ID: ${member.user_id}`}
                                                    {isMe && (
                                                        <span style={{ marginLeft: 6, fontSize: 11, color: '#1c7ed6', fontWeight: 500 }}>
                                                            (вы)
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{ fontSize: 12, marginTop: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    {m?.username && (
                                                        <span style={{ color: '#868e96' }}>@{m.username}</span>
                                                    )}
                                                    <span style={{
                                                        background: ROLE_COLORS[member.role] || '#868e96',
                                                        color: '#fff', borderRadius: 6,
                                                        padding: '1px 6px', fontSize: 10, fontWeight: 600
                                                    }}>
                                                        {ROLE_LABELS[member.role] || member.role}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Remove button */}
                                            {isAdmin && !isMe && (
                                                <button
                                                    onClick={() => handleRemove(member.user_id)}
                                                    disabled={!!processing}
                                                    title="Удалить из чата"
                                                    style={{
                                                        width: 32, height: 32, borderRadius: '50%', border: 'none',
                                                        background: isRemoving ? '#f8d7da' : '#fff0f0',
                                                        color: '#e03131', cursor: 'pointer', fontSize: 15,
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        flexShrink: 0, transition: 'all .15s',
                                                        opacity: processing && !isRemoving ? 0.5 : 1
                                                    }}
                                                    onMouseEnter={e => (e.currentTarget.style.background = '#ffc9c9')}
                                                    onMouseLeave={e => (e.currentTarget.style.background = '#fff0f0')}
                                                >
                                                    {isRemoving ? '⏳' : '✕'}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    ) : (
                        // Add tab
                        filteredNonMembers.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#aaa', paddingTop: 32, fontSize: 14 }}>
                                {nonMembers.length === 0 ? 'Все менеджеры уже в чате' : 'Никого не найдено'}
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {filteredNonMembers.map(manager => {
                                    const isAdding = processing === manager.id;
                                    return (
                                        <button
                                            key={manager.id}
                                            onClick={() => handleAdd(manager.id)}
                                            disabled={!!processing}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 12,
                                                padding: '10px 12px', borderRadius: 12, border: 'none',
                                                background: '#f8f9fa', cursor: 'pointer', textAlign: 'left',
                                                opacity: processing && !isAdding ? 0.5 : 1,
                                                transition: 'all .15s', width: '100%'
                                            }}
                                            onMouseEnter={e => { if (!processing) e.currentTarget.style.background = '#e8f4fd'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = '#f8f9fa'; }}
                                        >
                                            <div style={{
                                                width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                                                background: '#e9ecef',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                color: '#868e96', fontWeight: 700, fontSize: 15
                                            }}>
                                                {getInitials(manager.first_name, manager.last_name)}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontWeight: 600, fontSize: 14, color: '#212529' }}>
                                                    {manager.first_name} {manager.last_name}
                                                </div>
                                                <div style={{ fontSize: 12, color: '#868e96', marginTop: 1 }}>
                                                    @{manager.username}
                                                </div>
                                            </div>
                                            <div style={{
                                                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                                                background: isAdding ? '#a5d8ff' : '#d0ebff',
                                                color: '#1c7ed6', display: 'flex', alignItems: 'center',
                                                justifyContent: 'center', fontSize: 18, fontWeight: 700
                                            }}>
                                                {isAdding ? '⏳' : '+'}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )
                    )}
                </div>
            </div>
        </div>
    );
}
