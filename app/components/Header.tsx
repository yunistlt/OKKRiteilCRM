'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavigatorWithBadge = Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
};

export default function Header() {
    const [unreadCount, setUnreadCount] = useState(0);
    const pathname = usePathname();
    const hideOnMessengerMobile = pathname.startsWith('/messenger');

    useEffect(() => {
        fetchUnreadCount();

        const interval = setInterval(fetchUnreadCount, 30000); // Check every 30s
        return () => clearInterval(interval);
    }, []);

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

    useEffect(() => {
        const baseTitle = getPageTitle();
        document.title = unreadCount > 0 ? `(${unreadCount}) ${baseTitle}` : baseTitle;

        const navigatorWithBadge = navigator as NavigatorWithBadge;
        if (unreadCount > 0 && typeof navigatorWithBadge.setAppBadge === 'function') {
            navigatorWithBadge.setAppBadge(unreadCount).catch(() => undefined);
            return;
        }

        if (unreadCount === 0 && typeof navigatorWithBadge.clearAppBadge === 'function') {
            navigatorWithBadge.clearAppBadge().catch(() => undefined);
        }
    }, [pathname, unreadCount]);

    return (
        <header className={`${hideOnMessengerMobile ? 'hidden md:block ' : ''}bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-50`}>
            <div className="px-8 flex justify-between items-center h-16">
                
                <div className="flex items-center gap-4">
                    <h1 className="text-xl font-black text-gray-900 tracking-tight">
                        {getPageTitle()}
                    </h1>
                </div>

                <div className="flex items-center gap-6">
                    {/* Meta Info / Notifications */}
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
                    </div>
                </div>
            </div>
        </header>
    );
}
