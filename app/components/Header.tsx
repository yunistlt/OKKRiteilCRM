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
        if (pathname.startsWith('/agents')) return 'Каталог ИИ-агентов';
        if (pathname.startsWith('/okk')) return 'Контроль Качества';
        if (pathname.startsWith('/legal')) return 'Юридический отдел';
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
        if (pathname.startsWith('/salary/settings')) return 'Настройки мотивации';
        if (pathname.startsWith('/salary/my')) return 'Моя зарплата';
        if (pathname.startsWith('/salary')) return 'Зарплата и мотивация';
        return 'Центр Управления';
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
        <header className={`${hideOnMessengerMobile ? 'hidden md:block ' : ''}bg-white border-b border-border sticky top-0 z-50`}>
            <div className="px-6 flex justify-between items-center h-14">

                <h1 className="text-base font-bold uppercase tracking-tight text-foreground">
                    {getPageTitle()}
                </h1>

                {/* Быстрая ссылка на мессенджер */}
                <Link href="/messenger" className="relative flex h-9 w-9 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground">
                    <span className="text-lg">💬</span>
                    {unreadCount > 0 && (
                        <span className="absolute top-0.5 right-0.5 flex h-4 min-w-[16px] items-center justify-center bg-red-600 px-1 text-[9px] font-bold text-white">
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                    )}
                </Link>
            </div>
        </header>
    );
}
