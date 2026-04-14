'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

interface NavItem {
    name: string;
    href: string;
    icon: string;
    agent?: string;
}

interface NavGroup {
    title: string;
    items: NavItem[];
}

export default function Sidebar() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [user, setUser] = useState<{ username: string; role: string } | null>(null);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isMobileOpen, setIsMobileOpen] = useState(false);

    useEffect(() => {
        fetch('/api/auth/me')
            .then(res => res.json())
            .then(data => {
                if (data.authenticated) setUser(data.user);
            })
            .catch(console.error);
    }, []);

    // Close mobile sidebar on route change
    useEffect(() => {
        setIsMobileOpen(false);
    }, [pathname]);

    const groups: NavGroup[] = [
        {
            title: 'Управление',
            items: [
                { name: 'Центр Управления', href: '/', icon: '🏠' },
                { name: 'Контроль Качества', href: '/okk', icon: '📋', agent: 'maxim' },
                { name: 'Команда ОКК', href: '/?office=true', icon: '👥' },
                { name: 'Согласование Отмен', href: '/settings/ai-tools', icon: '🤖', agent: 'anna' },
            ]
        },
        {
            title: 'Аналитика',
            items: [
                { name: 'Хаб Аналитики', href: '/analytics', icon: '📊' },
            ]
        },
        {
            title: 'Связь',
            items: [
                { name: 'Мессенджер', href: '/messenger', icon: '💬' },
                { name: 'Реактивация', href: '/admin/reactivation', icon: '💌', agent: 'victoria' },
            ]
        },
        {
            title: 'Система',
            items: [
                { name: 'Статус Систем', href: '/settings/status', icon: '🛰️', agent: 'igor' },
                { name: 'Менеджеры', href: '/settings/managers', icon: '👤' },
                { name: 'Статусы Заказов', href: '/settings/statuses', icon: '📂' },
                { name: 'Правила (Rules)', href: '/settings/rules', icon: '⚖️' },
            ]
        },
        {
            title: 'AI Центр',
            items: [
                { name: 'Настройка Промпта', href: '/settings/ai', icon: '✍️' },
                { name: 'Примеры обучения', href: '/settings/ai/training-examples', icon: '📚' },
            ]
        }
    ];

    const isActive = (href: string) => {
        const [targetPath, targetQuery] = href.split('?');
        
        // Basic path segment matching
        let pathMatches = false;
        if (targetPath === '/') {
            pathMatches = pathname === '/';
        } else {
            pathMatches = pathname === targetPath || pathname.startsWith(targetPath + '/');
        }
        
        if (!pathMatches) return false;

        // If the item has a query string, it must match exactly
        if (targetQuery) {
            const params = new URLSearchParams(targetQuery);
            for (const [key, value] of Array.from(params.entries())) {
                if (searchParams.get(key) !== value) return false;
            }
            return true;
        }

        // Avoid double highlighting: if we are on a specialized version of the route (like /?office=true),
        // don't highlight the default route (/) if a more specific item exists.
        if (pathname === '/' && searchParams.get('office') === 'true' && !targetQuery) {
            return false;
        }

        return true;
    };

    return (
        <>
            {/* Mobile Toggle Button (Floating) */}
            <button
                onClick={() => setIsMobileOpen(!isMobileOpen)}
                className="md:hidden fixed bottom-6 right-6 z-[100] w-14 h-14 bg-blue-600 text-white rounded-full shadow-2xl flex items-center justify-center text-2xl active:scale-95 transition-all"
            >
                {isMobileOpen ? '✕' : '☰'}
            </button>

            {/* Mobile Overlay */}
            {isMobileOpen && (
                <div 
                    className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] animate-in fade-in"
                    onClick={() => setIsMobileOpen(false)}
                />
            )}

            <aside className={`fixed md:sticky top-0 left-0 h-screen transition-all duration-300 z-[80] flex flex-col bg-gray-900 text-white overflow-y-auto overflow-x-hidden border-r border-white/5 shadow-2xl no-scrollbar
                ${isMobileOpen ? 'translate-x-0 w-72' : '-translate-x-full md:translate-x-0'}
                ${isCollapsed ? 'md:w-20' : 'md:w-72'}
            `}>
                {/* Logo Section */}
                <div className="p-6 flex items-center justify-between">
                    <Link href="/" className="text-xl font-black tracking-tighter text-blue-400 group">
                        OKK<span className="text-white group-hover:text-blue-200 transition-colors">{isCollapsed ? '' : 'CRM'}</span>
                    </Link>
                    <button 
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="hidden md:block p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-gray-400"
                    >
                        {isCollapsed ? '→' : '←'}
                    </button>
                </div>

                {/* Navigation Groups */}
                <nav className="flex-1 px-4 py-2 space-y-8 no-scrollbar">
                    {groups.map((group, gIdx) => (
                        <div key={gIdx} className="space-y-2">
                            {(!isCollapsed || isMobileOpen) && (
                                <h3 className="px-4 text-[10px] font-black uppercase tracking-widest text-white/30">
                                    {group.title}
                                </h3>
                            )}
                            <div className="space-y-1">
                                {group.items.map((item, iIdx) => {
                                    const active = isActive(item.href);
                                    return (
                                        <Link
                                            key={iIdx}
                                            href={item.href}
                                            className={`group relative flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold transition-all ${
                                                active 
                                                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' 
                                                : 'text-gray-400 hover:bg-white/5 hover:text-white'
                                            }`}
                                        >
                                            <span className={`text-xl transition-transform ${active ? 'scale-110' : 'group-hover:scale-110'}`}>
                                                {item.icon}
                                            </span>
                                            {(!isCollapsed || isMobileOpen) && (
                                                <span className="truncate">{item.name}</span>
                                            )}

                                            {/* Agent Badge if exists */}
                                            {(!isCollapsed || isMobileOpen) && item.agent && (
                                                <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <img 
                                                        src={`/images/agents/${item.agent}.png`} 
                                                        alt={item.agent} 
                                                        className="w-5 h-5 rounded-full border border-white/20"
                                                    />
                                                </div>
                                            )}

                                            {/* Tooltip for collapsed mode */}
                                            {isCollapsed && !isMobileOpen && (
                                                <div className="absolute left-full ml-4 px-2 py-1 bg-gray-800 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity">
                                                    {item.name}
                                                </div>
                                            )}
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </nav>

                {/* User Profile Footer */}
                <div className="p-4 mt-auto border-t border-white/5 bg-black/20 backdrop-blur-md">
                    {user ? (
                        <div className={`flex items-center gap-3 ${isCollapsed && !isMobileOpen ? 'justify-center' : ''}`}>
                            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-black shadow-lg">
                                {user.username[0].toUpperCase()}
                            </div>
                            {(!isCollapsed || isMobileOpen) && (
                                <div className="flex flex-col min-w-0">
                                    <span className="text-sm font-black truncate">{user.username}</span>
                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{user.role}</span>
                                </div>
                            )}
                            {(!isCollapsed || isMobileOpen) && (
                                 <Link href="/settings/profile" className="ml-auto p-2 text-gray-500 hover:text-white transition-colors">
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path></svg>
                                 </Link>
                            )}
                        </div>
                    ) : (
                        <div className="h-10 animate-pulse bg-white/5 rounded-2xl w-full" />
                    )}
                </div>
            </aside>
        </>
    );
}
