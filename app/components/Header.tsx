'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import DateRangePicker from './DateRangePicker';

interface EfficiencyRow {
    manager_id: number;
    manager_name: string;
    total_minutes: number;
    processed_orders: number;
}

export default function Header() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
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
        window.location.href = '/login';
    };

    return (
        <header className="bg-gray-900 text-white shadow-md sticky top-0 z-50">
            <div className="container mx-auto px-4 py-3 flex justify-between items-center">

                {/* Logo / Home Link */}
                <Link href="/" className="text-xl font-bold tracking-tight text-blue-400 hover:text-blue-300 transition-colors">
                    OKKRiteilCRM
                </Link>

                {/* Desktop Global Date Filter */}
                <div className="hidden md:block">
                    <Suspense fallback={<div className="w-32 h-10 bg-gray-800 animate-pulse rounded-xl" />}>
                        <DateRangePicker />
                    </Suspense>
                </div>

                {/* Desktop Navigation */}
                <div className="hidden md:flex items-center gap-4">
                    <Link href="/okk" className="text-gray-400 hover:text-white transition-colors text-sm font-bold flex items-center gap-2">
                        <span className="text-base">📋</span>
                        Контроль качества
                    </Link>
                    {user?.role !== 'manager' && (
                        <>
                            <Link href="/?office=true" className="text-gray-400 hover:text-white transition-colors text-sm font-bold flex items-center gap-2">
                                <span className="text-base">👥</span>
                                Команда ОКК
                            </Link>
                            <Link href="/settings" className="text-gray-400 hover:text-white transition-colors text-sm font-bold flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                Настройки
                            </Link>
                        </>
                    )}
                    <div className="text-[10px] text-gray-600 font-black">v1.2</div>
                </div>

                {/* Desktop User Profile / Logout */}
                {user && (
                    <div className="hidden md:flex items-center gap-3 ml-4 pl-4 border-l border-gray-800">
                        <div className="flex flex-col items-end">
                            <span className="text-sm font-bold text-gray-200">{user.username}</span>
                            <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{user.role}</span>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-blue-900 text-blue-300 flex items-center justify-center font-bold text-xs shrink-0">
                            {user.username.substring(0, 2).toUpperCase()}
                        </div>
                        <button
                            onClick={handleLogout}
                            className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-900/30 rounded-lg transition-colors ml-2"
                            title="Выйти"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                        </button>
                    </div>
                )}

                {/* Mobile Menu Button */}
                <button
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    className="md:hidden p-2 text-gray-400 hover:text-white transition-colors"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {isMenuOpen ? (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7" />
                        )}
                    </svg>
                </button>
            </div>

            {/* Mobile Navigation Drawer */}
            <div className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out ${isMenuOpen ? 'max-h-96 border-t border-gray-800' : 'max-h-0'}`}>
                <div className="container mx-auto px-4 py-6 flex flex-col gap-6">
                    <div className="flex flex-col gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Период</span>
                        <Suspense fallback={<div className="w-full h-10 bg-gray-800 animate-pulse rounded-xl" />}>
                            <DateRangePicker />
                        </Suspense>
                    </div>

                    <div className="flex flex-col gap-4">
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Навигация</span>
                        <Link
                            href="/okk"
                            onClick={() => setIsMenuOpen(false)}
                            className="bg-gray-800 p-4 rounded-2xl text-white font-bold flex items-center justify-between group active:bg-blue-600 transition-colors"
                        >
                            <span className="flex items-center gap-2"><span className="text-xl">📋</span> Контроль качества</span>
                            <svg className="w-5 h-5 text-gray-500 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                        </Link>
                        {user?.role !== 'manager' && (
                            <>
                                <Link
                                    href="/?office=true"
                                    onClick={() => setIsMenuOpen(false)}
                                    className="bg-gray-800 p-4 rounded-2xl text-white font-bold flex items-center justify-between group active:bg-blue-600 transition-colors"
                                >
                                    <span className="flex items-center gap-2"><span className="text-xl">👥</span> Команда ОКК</span>
                                    <svg className="w-5 h-5 text-gray-500 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                                </Link>
                                <Link
                                    href="/settings"
                                    onClick={() => setIsMenuOpen(false)}
                                    className="bg-gray-800 p-4 rounded-2xl text-white font-bold flex items-center justify-between group active:bg-blue-600 transition-colors"
                                >
                                    <span>Настройки</span>
                                    <svg className="w-5 h-5 text-gray-500 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                                </Link>
                                <Link
                                    href="/analytics"
                                    onClick={() => setIsMenuOpen(false)}
                                    className="bg-gray-800 p-4 rounded-2xl text-white font-bold flex items-center justify-between group active:bg-blue-600 transition-colors"
                                >
                                    <span>Аналитика</span>
                                    <svg className="w-5 h-5 text-gray-500 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                                </Link>
                            </>
                        )}
                    </div>

                    <div className="text-[10px] text-gray-600 font-black text-center pt-4">OKKRiteilCRM v1.2</div>

                    {/* Mobile User Profile / Logout */}
                    {user && (
                        <div className="flex items-center justify-between border-t border-gray-800 pt-4 mt-2">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-blue-900 text-blue-300 flex items-center justify-center font-bold text-sm shrink-0">
                                    {user.username.substring(0, 2).toUpperCase()}
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-sm font-bold text-white">{user.username}</span>
                                    <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{user.role}</span>
                                </div>
                            </div>
                            <button
                                onClick={handleLogout}
                                className="p-3 text-red-400 hover:bg-red-900/30 rounded-xl transition-colors bg-gray-800"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}
