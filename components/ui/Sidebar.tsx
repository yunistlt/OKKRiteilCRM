'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { AppRole } from '@/lib/auth';
import { canAccessPathWithRules } from '@/lib/rbac';
import { useAuth } from '@/components/auth/AuthProvider';
import { resolveMessengerAvatarSrc } from '@/lib/messenger/avatar';

interface NavItem {
    name: string;
    href: string;
    icon: string;
    agent?: string;
    allowed?: AppRole[];
}

interface NavGroup {
    title: string;
    items: NavItem[];
}

export default function Sidebar() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { user, permissionRules } = useAuth();
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const isMessengerRoute = pathname.startsWith('/messenger');
    const avatarSrc = resolveMessengerAvatarSrc(user?.avatar_url);
    const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || user?.username || 'User';
    const initials = `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}`.toUpperCase() || user?.username?.[0]?.toUpperCase() || 'U';

    // Close mobile sidebar on route change
    useEffect(() => {
        setIsMobileOpen(false);
    }, [pathname]);

    useEffect(() => {
        const handleOpenMobileSidebar = () => {
            setIsMobileOpen(true);
        };

        window.addEventListener('open-mobile-sidebar', handleOpenMobileSidebar);
        return () => window.removeEventListener('open-mobile-sidebar', handleOpenMobileSidebar);
    }, []);

    const groups: NavGroup[] = [
        {
            title: 'Управление',
            items: [
                { name: 'Центр Управления', href: '/', icon: '🏠', allowed: ['admin', 'okk', 'rop'] },
                { name: 'Контроль Качества', href: '/okk', icon: '📋', agent: 'maxim' },
                { name: 'Все ИИ-агенты', href: '/agents', icon: '🧠', allowed: ['admin', 'okk', 'rop', 'manager'] },
                { name: 'Команда ОКК', href: '/?office=true', icon: '👥', allowed: ['admin', 'okk', 'rop'] },
                { name: 'Согласование Отмен', href: '/settings/ai-tools', icon: '🤖', agent: 'anna', allowed: ['admin', 'okk'] },
            ]
        },
        {
            title: 'Аналитика',
            items: [
                { name: 'Хаб Аналитики', href: '/analytics', icon: '📊', allowed: ['admin', 'okk', 'rop'] },
            ]
        },
        {
            title: 'Связь',
            items: [
                { name: 'Мессенджер', href: '/messenger', icon: '💬' },
                { name: 'Реактивация', href: '/reactivation', icon: '💌', agent: 'victoria', allowed: ['admin', 'rop'] },
            ]
        },
        {
            title: 'Юридический отдел',
            items: [
                { name: 'Юридический отдел', href: '/legal', icon: '⚖️', allowed: ['admin', 'okk', 'rop', 'manager'] },
            ]
        },
        {
            title: 'Система',
            items: [
                { name: 'Статус Систем', href: '/settings/status', icon: '🛰️', agent: 'igor', allowed: ['admin'] },
                { name: 'Доступы и права', href: '/settings/access', icon: '🛡️', allowed: ['admin'] },
                { name: 'Менеджеры', href: '/settings/managers', icon: '👤', allowed: ['admin'] },
                { name: 'Статусы Заказов', href: '/settings/statuses', icon: '📂', allowed: ['admin'] },
                { name: 'Правила (Rules)', href: '/settings/rules', icon: '⚖️', allowed: ['admin'] },
            ]
        },
        {
            title: 'AI Центр',
            items: [
                { name: 'Настройка Промпта', href: '/settings/ai', icon: '✍️', allowed: ['admin'] },
                { name: 'Примеры обучения', href: '/settings/ai/training-examples', icon: '📚', allowed: ['admin'] },
            ]
        }
    ];

    const visibleGroups = groups
        .map((group) => ({
            ...group,
            items: group.items.filter((item) => canAccessPathWithRules(user?.role, item.href.split('?')[0], permissionRules)),
        }))
        .filter((group) => group.items.length > 0);

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
            {!isMessengerRoute && (
                <button
                    onClick={() => setIsMobileOpen(!isMobileOpen)}
                    className="md:hidden fixed bottom-6 right-6 z-[110] flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white text-2xl shadow-2xl transition-all active:scale-95"
                    aria-label={isMobileOpen ? 'Закрыть меню' : 'Открыть меню'}
                >
                    {isMobileOpen ? '✕' : '☰'}
                </button>
            )}

            {/* Mobile Overlay */}
            {isMobileOpen && (
                <div 
                    className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] animate-in fade-in"
                    onClick={() => setIsMobileOpen(false)}
                />
            )}

            <aside className={`fixed md:sticky top-0 left-0 h-screen transition-all duration-300 z-[120] flex flex-col bg-gray-900 text-white overflow-y-auto overflow-x-hidden border-r border-white/5 shadow-2xl no-scrollbar
                ${isMobileOpen ? 'translate-x-0 w-72' : '-translate-x-full md:translate-x-0'}
                ${isCollapsed ? 'md:w-20' : 'md:w-72'}
            `}>
                {/* Logo Section */}
                <div className={`flex ${isCollapsed && !isMobileOpen ? 'px-3 py-5 flex-col items-center gap-3' : 'p-6 items-center justify-between'}`}>
                    <Link href="/" className="text-xl font-black tracking-tighter text-blue-400 group">
                        OKK<span className="text-white group-hover:text-blue-200 transition-colors">{isCollapsed ? '' : 'CRM'}</span>
                    </Link>
                    <button 
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="hidden md:flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/15 text-white shadow-lg shadow-black/30 transition-all hover:bg-blue-500 hover:border-blue-300/40"
                        aria-label={isCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
                    >
                        {isCollapsed ? '→' : '←'}
                    </button>
                </div>

                {/* Navigation Groups */}
                <nav className="flex-1 px-4 py-2 space-y-8 no-scrollbar">
                    {visibleGroups.map((group, gIdx) => (
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
                            <div className="w-10 h-10 overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-black shadow-lg">
                                {avatarSrc ? (
                                    <img src={avatarSrc} alt={displayName} className="h-full w-full object-cover" />
                                ) : (
                                    initials
                                )}
                            </div>
                            {(!isCollapsed || isMobileOpen) && (
                                <div className="flex flex-col min-w-0">
                                    <span className="text-sm font-black truncate">{displayName}</span>
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
