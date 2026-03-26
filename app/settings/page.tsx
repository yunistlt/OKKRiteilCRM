'use client';

import React from 'react';
import Link from 'next/link';

export default function SettingsIndexPage() {
    return (
        <div className="max-w-4xl px-2 md:px-0">
            <h1 className="text-3xl md:text-4xl font-black text-gray-900 tracking-tight mb-2 md:mb-4">Настройки</h1>
            <p className="text-gray-500 mb-8 md:mb-12 text-base md:text-lg">Управление конфигурацией системы мониторинга и контроля.</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                <Link href="/settings/managers" className="group p-6 md:p-8 bg-white border border-gray-100 rounded-2xl md:rounded-3xl shadow-xl shadow-gray-200/50 hover:shadow-blue-100 hover:border-blue-100 transition-all relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-30 transition-opacity">
                        <img src="/images/agents/anna.png" alt="" className="w-12 h-12 rounded-full" />
                    </div>
                    <div className="text-3xl md:text-4xl mb-4 md:mb-6 group-hover:scale-110 transition-transform origin-left">👤</div>
                    <h3 className="text-lg md:text-xl font-black text-gray-900 mb-2 uppercase tracking-tight">Менеджеры</h3>
                    <p className="text-gray-500 text-sm leading-relaxed">
                        Выбор сотрудников и настройка списка контроля.
                    </p>
                </Link>

                <Link href="/settings/statuses" className="group p-6 md:p-8 bg-white border border-gray-100 rounded-2xl md:rounded-3xl shadow-xl shadow-gray-200/50 hover:shadow-blue-100 hover:border-blue-100 transition-all relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-30 transition-opacity">
                        <img src="/images/agents/igor.png" alt="" className="w-12 h-12 rounded-full" />
                    </div>
                    <div className="text-3xl md:text-4xl mb-4 md:mb-6 group-hover:scale-110 transition-transform origin-left">📊</div>
                    <h3 className="text-lg md:text-xl font-black text-gray-900 mb-2 uppercase tracking-tight">Статусы Заказов</h3>
                    <p className="text-gray-500 text-sm leading-relaxed">
                        Настройка рабочих статусов и логики "зависших" сделок.
                    </p>
                </Link>

                <Link href="/settings/rules" className="group p-6 md:p-8 bg-white border border-gray-100 rounded-2xl md:rounded-3xl shadow-xl shadow-gray-200/50 hover:shadow-orange-100 hover:border-orange-100 transition-all relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-30 transition-opacity">
                        <img src="/images/agents/maxim.png" alt="" className="w-12 h-12 rounded-full" />
                    </div>
                    <div className="text-3xl md:text-4xl mb-4 md:mb-6 group-hover:scale-110 transition-transform origin-left">⚖️</div>
                    <h3 className="text-lg md:text-xl font-black text-gray-900 mb-2 uppercase tracking-tight">Правила (Rules)</h3>
                    <p className="text-gray-500 text-sm leading-relaxed">
                        Регламенты и автоматические проверки нарушений.
                    </p>
                </Link>

                <Link href="/settings/ai-tools" className="group p-6 md:p-8 bg-white border border-gray-100 rounded-2xl md:rounded-3xl shadow-xl shadow-gray-200/50 hover:shadow-blue-100 hover:border-blue-100 transition-all relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-30 transition-opacity">
                        <img src="/images/agents/maxim.png" alt="" className="w-12 h-12 rounded-full" />
                    </div>
                    <div className="text-3xl md:text-4xl mb-4 md:mb-6 group-hover:scale-110 transition-transform origin-left">🤖</div>
                    <h3 className="text-lg md:text-xl font-black text-gray-900 mb-2 uppercase tracking-tight">AI Инструменты</h3>
                    <p className="text-gray-500 text-sm leading-relaxed">
                        Ручная и автоматическая маршрутизация заказов (Отмены).
                    </p>
                </Link>

                <Link href="/settings/status" className="group p-6 md:p-8 bg-white border border-gray-100 rounded-2xl md:rounded-3xl shadow-xl shadow-gray-200/50 hover:shadow-yellow-100 hover:border-yellow-100 transition-all relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-30 transition-opacity flex gap-1">
                        <img src="/images/agents/igor.png" alt="" className="w-8 h-8 rounded-full" />
                        <img src="/images/agents/semen.png" alt="" className="w-8 h-8 rounded-full" />
                    </div>
                    <div className="text-3xl md:text-4xl mb-4 md:mb-6 group-hover:scale-110 transition-transform origin-left">⚡️</div>
                    <h3 className="text-lg md:text-xl font-black text-gray-900 mb-2 uppercase tracking-tight">Статус Систем</h3>
                    <p className="text-gray-500 text-sm leading-relaxed">
                        Мониторинг обновлений и технических метрик.
                    </p>
                </Link>

                <Link href="/settings/ai" className="group p-6 md:p-8 bg-white border border-gray-100 rounded-2xl md:rounded-3xl shadow-xl shadow-gray-200/50 hover:shadow-purple-100 hover:border-purple-100 transition-all relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-30 transition-opacity flex gap-1">
                        <img src="/images/agents/anna.png" alt="" className="w-8 h-8 rounded-full" />
                        <img src="/images/agents/maxim.png" alt="" className="w-8 h-8 rounded-full" />
                    </div>
                    <div className="text-3xl md:text-4xl mb-4 md:mb-6 group-hover:scale-110 transition-transform origin-left">🧠</div>
                    <h3 className="text-lg md:text-xl font-black text-gray-900 mb-2 uppercase tracking-tight">Настройка Промпта</h3>
                    <p className="text-gray-500 text-sm leading-relaxed">
                        Редактирование инструкций для ИИ (Светофор и Роутинг).
                    </p>
                </Link>

                <Link href="/admin/reactivation" className="group p-6 md:p-8 bg-white border border-gray-100 rounded-2xl md:rounded-3xl shadow-xl shadow-gray-200/50 hover:shadow-indigo-100 hover:border-indigo-100 transition-all relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-30 transition-opacity">
                        <span className="text-4xl">💌</span>
                    </div>
                    <div className="text-3xl md:text-4xl mb-4 md:mb-6 group-hover:scale-110 transition-transform origin-left">💌</div>
                    <h3 className="text-lg md:text-xl font-black text-gray-900 mb-2 uppercase tracking-tight">Реактивация (Виктория)</h3>
                    <p className="text-gray-500 text-sm leading-relaxed">
                        Возврат клиентов через персональные письма от лица менеджера.
                    </p>
                </Link>

                <Link href="/settings/ai/training-examples" className="group p-6 md:p-8 bg-white border border-gray-100 rounded-2xl md:rounded-3xl shadow-xl shadow-gray-200/50 hover:shadow-pink-100 hover:border-pink-100 transition-all relative overflow-hidden">
                    <div className="text-3xl md:text-4xl mb-4 md:mb-6 group-hover:scale-110 transition-transform origin-left">📚</div>
                    <h3 className="text-lg md:text-xl font-black text-gray-900 mb-2 uppercase tracking-tight">Примеры Обучения</h3>
                    <p className="text-gray-500 text-sm leading-relaxed">
                        База знаний (Few-Shot) для обучения модели.
                    </p>
                </Link>
            </div>
        </div>
    );
}
