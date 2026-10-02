'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDayPlan } from '@/components/sales-rop/DayPlanContext';
import { useAuth } from '@/components/auth/AuthProvider';
import { resolvePageTitle } from '@/lib/nav';
import { useBreadcrumbs } from '@/components/ui/BreadcrumbsContext';

type NavigatorWithBadge = Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
};

export default function Header() {
    const [unreadCount, setUnreadCount] = useState(0);
    const pathname = usePathname();
    // План дня открывается сам утром; кнопка нужна, чтобы вернуть его после закрытия.
    const { open: planOpen, setOpen: setPlanOpen } = useDayPlan();
    const { permissionRules } = useAuth();
    const { crumbs } = useBreadcrumbs();
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

    // Название подраздела — из меню (`lib/nav.ts`), а не из списка в шапке:
    // раньше на «Заказах», «Клиентах» и любом новом экране писалось
    // «Центр Управления».
    const getPageTitle = () => resolvePageTitle(pathname, permissionRules);

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
        <header data-ui-audit-zone="header" className={`${hideOnMessengerMobile ? 'hidden md:block ' : ''}bg-white border-b border-border sticky top-0 z-50`}>
            <div className="px-6 flex justify-between items-center h-14">

                {/* Название раздела — первая крошка. Открытый поверх экран
                    добавляет свою, и по разделу можно вернуться назад. */}
                <h1 className="flex min-w-0 items-center gap-2 text-base font-bold uppercase tracking-tight text-foreground">
                    {crumbs.length > 0 && crumbs[0].back ? (
                        <button
                            type="button"
                            onClick={() => crumbs[0].back?.()}
                            className="shrink-0 uppercase text-blue-700 hover:underline"
                            title="Вернуться к списку"
                        >
                            {getPageTitle()}
                        </button>
                    ) : (
                        <span className="truncate">{getPageTitle()}</span>
                    )}
                    {crumbs.map((crumb, index) => (
                        <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-2">
                            <span className="shrink-0 font-normal text-muted-foreground">/</span>
                            {index < crumbs.length - 1 && crumb.back ? (
                                <button
                                    type="button"
                                    onClick={() => crumb.back?.()}
                                    className="truncate uppercase text-blue-700 hover:underline"
                                >
                                    {crumb.label}
                                </button>
                            ) : (
                                <span className="truncate">{crumb.label}</span>
                            )}
                        </span>
                    ))}
                </h1>

                <div className="ml-auto flex items-center gap-2">
                {/* На рабочем месте план висит постоянно справа; кнопка нужна
                    только на телефоне, где он открывается поверх экрана. */}
                <button
                    type="button"
                    onClick={() => setPlanOpen(!planOpen)}
                    title="План на день"
                    className={`flex h-9 items-center gap-1.5 px-3 text-xs font-black uppercase tracking-widest md:hidden ${
                        planOpen ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
                    }`}
                >
                    План дня
                </button>

                {/* Быстрая ссылка на мессенджер. На «Моём дне» её нет: экран про
                    одно следующее действие, лишние кнопки там шумят. */}
                <Link href="/messenger" className={`relative h-9 w-9 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground ${pathname.startsWith('/analytics') ? 'hidden' : 'flex'}`}>
                    <span className="text-lg">💬</span>
                    {unreadCount > 0 && (
                        <span className="absolute top-0.5 right-0.5 flex h-4 min-w-[16px] items-center justify-center bg-red-600 px-1 text-[9px] font-bold text-white">
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                    )}
                </Link>
                </div>
            </div>
        </header>
    );
}
