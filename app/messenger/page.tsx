'use client';

import React from 'react';
import MessengerPanel from '@/components/messenger/MessengerPanel';

export default function MessengerPage() {
    return (
        <div className="h-[100dvh] min-h-0 w-full overflow-hidden bg-[#eef3f8] px-0 py-0 md:h-full md:bg-transparent md:px-6 md:py-8">
            <div className="hidden md:mb-6 md:flex md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                    <h1 className="text-2xl font-bold text-gray-900">Корпоративный мессенджер</h1>
                    <p className="text-sm text-gray-500">Обмен сообщениями и файлами между сотрудниками и ИИ-агентами</p>
                </div>
                <div className="flex gap-2 self-start">
                    <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                        Realtime Active
                    </span>
                </div>
            </div>
            
            <MessengerPanel />
            
            <div className="mt-8 hidden grid-cols-1 gap-6 md:grid md:grid-cols-3">
                <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                    <h4 className="font-semibold text-blue-900 mb-1 flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Совет
                    </h4>
                    <p className="text-xs text-blue-800 leading-relaxed">
                        Вы можете привязывать чаты к конкретным заказам. Это поможет коллегам быстрее войти в контекст обсуждения.
                    </p>
                </div>
                <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
                    <h4 className="font-semibold text-amber-900 mb-1 flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        Важно
                    </h4>
                    <p className="text-xs text-amber-800 leading-relaxed">
                        Все переписки защищены. Сообщения и файлы доступны только прямым участникам чата.
                    </p>
                </div>
                <div className="p-4 bg-purple-50 rounded-xl border border-purple-100">
                    <h4 className="font-semibold text-purple-900 mb-1 flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                        </svg>
                        ИИ-Агенты
                    </h4>
                    <p className="text-xs text-purple-800 leading-relaxed">
                        Игорь, Максим и Анна могут присылать вам уведомления прямо сюда. Не забывайте проверять личные чаты с ботами.
                    </p>
                </div>
            </div>
        </div>
    );
}
