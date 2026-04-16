'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';

export default function Header() {
    const [unreadCount, setUnreadCount] = useState(0);
    const pathname = usePathname();
    const { user } = useAuth();

    useEffect(() => {
        if (user) {
            fetchUnreadCount();
        }

        const interval = setInterval(fetchUnreadCount, 30000); // Check every 30s
        return () => clearInterval(interval);
    }, [user]);

    const fetchUnreadCount = async () => {
        try {
            const res = await fetch('/api/messenger/chats?count=true');
            if (res.ok) {
                const data = await res.json();
                setUnreadCount(data.count || 0);
            }
        } catch (e) {
            console.error('Failed to fetch unread count:', e);
        }
    };

    const handleLogout = async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
    };

    const getPageTitle = () => {
        if (pathname === '/') return 'Центр Управления';
        if (pathname.startsWith('/okk')) return 'Контроль Качества';
        if (pathname.startsWith('/messenger')) return 'Мессенджер';
        if (pathname.startsWith('/analytics')) return 'Аналитика';
        if (pathname.startsWith('/efficiency')) return 'Эффективность';
        if (pathname.startsWith('/settings/status')) return 'Статус Систем';
        if (pathname.startsWith('/settings/managers')) return 'Менеджеры';
        if (pathname.startsWith('/settings/rules')) return 'Правила (Rules)';
        if (pathname.startsWith('/settings/ai-tools')) return 'AI Инструменты';
        if (pathname.startsWith('/settings/ai')) return 'Настройка Промпта';
        if (pathname.startsWith('/settings')) return 'Настройки';
        if (pathname.startsWith('/admin')) return 'Администрирование';
        return 'Dashboard';
    };

    return (
        <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-50">
            <div className="px-8 flex justify-between items-center h-16">
                
                <div className="flex items-center gap-4">
                    <h1 className="text-xl font-black text-gray-900 tracking-tight">
                        {getPageTitle()}
                    </h1>
                </div>

                <div className="flex items-center gap-6">
                    {/* Meta Info / Notifications / User */}
                    <div className="flex items-center gap-4 pl-6 border-l border-gray-100">
                        {/* Notifications / Messenger Quick Link */}
                        <Link href="/messenger" className="relative p-2 text-gray-400 hover:text-blue-600 transition-all hover:scale-110">
                            <span className="text-xl">💬</span>
                            {unreadCount > 0 && (
                                <span className="absolute top-1 right-1 bg-red-500 text-white text-[9px] font-black px-1 rounded-full min-w-[14px] h-3.5 flex items-center justify-center border-2 border-white animate-pulse">
                                    {unreadCount > 9 ? '9+' : unreadCount}
                                </span>
                            )}
                        </Link>

                        {/* User Profile */}
                        {user && (
                            <div className="flex items-center gap-3 ml-2">
                                {(() => {
                                    const username = user.username || 'User';
                                    return (
                                        <>
                                <div className="flex flex-col items-end">
                                    <span className="text-xs font-black text-gray-900 leading-tight truncate max-w-[120px]">{username}</span>
                                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{user.role}</span>
                                </div>
                                <div className="w-9 h-9 rounded-xl bg-gray-900 text-white flex items-center justify-center font-black text-xs shrink-0 shadow-lg shadow-gray-200">
                                    {username.substring(0, 2).toUpperCase()}
                                </div>
                                        </>
                                    );
                                })()}
                                <button
                                    onClick={handleLogout}
                                    className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                    title="Выйти"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                    </svg>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </header>
    );
}
