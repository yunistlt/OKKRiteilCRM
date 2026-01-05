'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function SettingsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();

    const tabs = [
        { name: 'Менеджеры', href: '/settings/managers', icon: '👤' },
        { name: 'Статусы Заказов', href: '/settings/statuses', icon: '📊' },
        { name: 'Правила (Rules)', href: '/settings/rules', icon: '⚖️' },
        { name: 'Статус Систем', href: '/settings/status', icon: '⚡️' },
    ];

    const aiTabs = [
        { name: 'Настройка Промпта', href: '/settings/ai', icon: '🤖' },
        { name: 'Примеры Обучения', href: '/settings/ai/training-examples', icon: '📚' },
    ];

    return (
        <div className="min-h-screen bg-gray-50 flex">
            {/* Sidebar */}
            <aside className="w-64 bg-white border-r border-gray-100 shadow-sm flex flex-col">
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

                <div className="p-8">
                    <Link href="/analytics" className="flex items-center gap-2 text-xs font-bold text-gray-400 hover:text-blue-600 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7 7-7" /></svg>
                        Вернуться в Аналитику
                    </Link>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto">
                <div className="p-8">
                    {children}
                </div>
            </main>
        </div>
    );
}
