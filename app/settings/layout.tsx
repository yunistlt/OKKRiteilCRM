'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export default function SettingsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const [user, setUser] = useState<{ username: string; role: string } | null>(null);

    useEffect(() => {
        fetch('/api/auth/me')
            .then(res => res.json())
            .then(data => {
                if (data.authenticated) setUser(data.user);
            })
            .catch(console.error);
    }, []);

    const handleLogout = async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        router.push('/login');
    };

    const tabs = [
        { name: 'Менеджеры', href: '/settings/managers', icon: '👤' },
        { name: 'Статусы Заказов', href: '/settings/statuses', icon: '📊' },
        { name: 'Правила (Rules)', href: '/settings/rules', icon: '⚖️' },
        { name: 'AI Инструменты', href: '/settings/ai-tools', icon: '🤖' },
        { name: 'Статус Систем', href: '/settings/status', icon: '⚡️' },
        { name: 'Реактивация (Виктория)', href: '/admin/reactivation', icon: '💌' },
        { name: 'Профиль', href: '/settings/profile', icon: '🔑' },
    ];

    const aiTabs = [
        { name: 'Настройка Промпта', href: '/settings/ai', icon: '🤖' },
        { name: 'Примеры Обучения', href: '/settings/ai/training-examples', icon: '📚' },
    ];

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
            {/* Mobile Navigation (Horizontal Scroll) - Hide on main settings page to avoid duplicate nav */}
            {pathname !== '/settings' && pathname !== '/settings/' && (
                <div className="md:hidden bg-white border-b border-gray-100 overflow-x-auto whitespace-nowrap p-4 flex gap-2 no-scrollbar">
                    {[...tabs, ...aiTabs].map((tab) => {
                        const isActive = pathname === tab.href;
                        return (
                            <Link
                                key={tab.href}
                                href={tab.href}
                                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${isActive
                                    ? 'bg-blue-600 text-white shadow-md'
                                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                                    }`}
                            >
                                <span>{tab.icon}</span>
                                {tab.name}
                            </Link>
                        );
                    })}
                </div>
            )}

            {/* Desktop Sidebar */}
            <aside className="hidden md:flex w-64 bg-white border-r border-gray-100 shadow-sm flex-col sticky top-0 h-screen overflow-y-auto">
                <div className="p-8">
                    <Link href="/" className="text-xl font-black text-blue-600 tracking-tighter">
                        OKK<span className="text-gray-900">CRM</span>
                    </Link>
                </div>

                <nav className="flex-1 px-4 space-y-1">
                    <p className="px-4 text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4">Настройки системы</p>
                    {tabs.map((tab) => {
                        const isActive = pathname === tab.href;
                        return (
                            <Link
                                key={tab.href}
                                href={tab.href}
                                className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-black transition-all ${isActive
                                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                                    : 'text-gray-400 hover:bg-gray-50 hover:text-gray-900'
                                    }`}
                            >
                                <span className="text-lg">{tab.icon}</span>
                                {tab.name}
                            </Link>
                        );
                    })}

                    <p className="px-4 text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4 mt-6">AI Обучение</p>
                    {aiTabs.map((tab) => {
                        const isActive = pathname === tab.href;
                        return (
                            <Link
                                key={tab.href}
                                href={tab.href}
                                className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-black transition-all ${isActive
                                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-100'
                                    : 'text-gray-400 hover:bg-gray-50 hover:text-gray-900'
                                    }`}
                            >
                                <span className="text-lg">{tab.icon}</span>
                                {tab.name}
                            </Link>
                        );
                    })}
                </nav>

                <div className="p-4 mt-auto border-t border-gray-100 flex flex-col gap-2">
                    <Link href="/analytics" className="flex items-center gap-2 text-xs font-bold text-gray-400 hover:text-blue-600 transition-colors px-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7 7-7" /></svg>
                        Вернуться в Аналитику
                    </Link>
                    {user && (
                        <div className="flex items-center gap-2 px-2 mt-1">
                            <Link href="/settings/profile" className="flex items-center gap-2 flex-1 min-w-0 hover:opacity-80 transition-opacity">
                                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xs font-black flex-shrink-0">
                                    {user.username[0].toUpperCase()}
                                </div>
                                <span className="text-xs font-bold text-gray-600 truncate">{user.username}</span>
                            </Link>
                            <button
                                onClick={handleLogout}
                                title="Выйти"
                                className="ml-auto p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                </svg>
                            </button>
                        </div>
                    )}
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto">
                <div className="p-4 md:p-8">
                    {children}
                </div>
            </main>
        </div>
    );
}
