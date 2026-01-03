'use client';

import React from 'react';
import Link from 'next/link';

export default function SettingsIndexPage() {
    return (
        <div className="max-w-4xl">
            <h1 className="text-4xl font-black text-gray-900 tracking-tight mb-4">Настройки</h1>
            <p className="text-gray-500 mb-12 text-lg">Управление конфигурацией системы мониторинга и контроля.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Link href="/settings/managers" className="group p-8 bg-white border border-gray-100 rounded-3xl shadow-xl shadow-gray-200/50 hover:shadow-blue-100 hover:border-blue-100 transition-all">
                    <div className="text-4xl mb-6 group-hover:scale-110 transition-transform origin-left">👤</div>
                    <h3 className="text-xl font-black text-gray-900 mb-2 uppercase tracking-tight">Менеджеры</h3>
                    <p className="text-gray-500 text-sm leading-relaxed">
                        Выбор сотрудников, чьи показатели будут учитываться в отчетах. Настройка списка контроля.
                    </p>
                </Link>

                <Link href="/settings/statuses" className="group p-8 bg-white border border-gray-100 rounded-3xl shadow-xl shadow-gray-200/50 hover:shadow-blue-100 hover:border-blue-100 transition-all">
                    <div className="text-4xl mb-6 group-hover:scale-110 transition-transform origin-left">📊</div>
                    <h3 className="text-xl font-black text-gray-900 mb-2 uppercase tracking-tight">Статусы Заказов</h3>
                    <p className="text-gray-500 text-sm leading-relaxed">
                        Определение «рабочих» статусов для расчета эффективности и времени нахождения в работе.
                    </p>
                </Link>

                <Link href="/settings/ai" className="group p-8 bg-white border border-gray-100 rounded-3xl shadow-xl shadow-gray-200/50 hover:shadow-purple-100 hover:border-purple-100 transition-all">
                    <div className="text-4xl mb-6 group-hover:scale-110 transition-transform origin-left">🧠</div>
                    <h3 className="text-xl font-black text-gray-900 mb-2 uppercase tracking-tight">Обучение ИИ</h3>
                    <p className="text-gray-500 text-sm leading-relaxed">
                        Настройка промтов и правил анализа. Тестирование логики светофора на реальных сделках.
                    </p>
                </Link>
            </div>
        </div>
    );
}
