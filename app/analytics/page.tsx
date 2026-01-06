'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function HubContent() {
    const searchParams = useSearchParams();
    const q = searchParams.toString();
    const suffix = q ? `?${q}` : '';

    return (
        <div className="max-w-5xl mx-auto px-2 md:px-0">
            <div className="flex flex-col md:flex-row md:items-center gap-4 mb-10 md:mb-12">
                <div className="flex items-center gap-4">
                    <Link href="/" className="p-2.5 md:p-3 bg-white rounded-xl md:rounded-2xl shadow-sm border border-gray-100 text-gray-400 hover:text-blue-600 transition-all">
                        <svg className="w-5 h-5 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7 7-7" /></svg>
                    </Link>
                    <div>
                        <h1 className="text-3xl md:text-4xl font-black text-gray-900 tracking-tight">Центр Аналитики</h1>
                        <p className="text-gray-400 font-bold uppercase text-[9px] md:text-[10px] tracking-widest mt-1">Выберите отчет для детального анализа</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-8">

                {/* 1. Efficiency */}
                <Link href={`/efficiency${suffix}`} className="group block p-6 md:p-8 bg-white border border-gray-100 rounded-[32px] md:rounded-[40px] shadow-xl shadow-gray-200/50 hover:shadow-2xl hover:shadow-blue-200/40 hover:-translate-y-1 transition-all">
                    <div className="w-12 h-12 md:w-14 md:h-14 bg-green-50 rounded-xl md:rounded-2xl flex items-center justify-center mb-6 text-green-600 group-hover:scale-110 transition-transform">
                        <svg className="w-6 h-6 md:w-7 md:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                    </div>
                    <h3 className="text-xl md:text-2xl font-black text-gray-900 mb-3 tracking-tight">Эффективность</h3>
                    <p className="text-sm text-gray-400 font-medium leading-relaxed">
                        Учет рабочего времени и обработанных заказов за выбранный период.
                    </p>
                </Link>

                {/* 2. Violations */}
                <Link href={`/analytics/violations${suffix}`} className="group block p-6 md:p-8 bg-white border border-gray-100 rounded-[32px] md:rounded-[40px] shadow-xl shadow-gray-200/50 hover:shadow-2xl hover:shadow-red-200/40 hover:-translate-y-1 transition-all">
                    <div className="w-12 h-12 md:w-14 md:h-14 bg-red-50 rounded-xl md:rounded-2xl flex items-center justify-center mb-6 text-red-600 group-hover:scale-110 transition-transform">
                        <svg className="w-6 h-6 md:w-7 md:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                        </svg>
                    </div>
                    <h3 className="text-xl md:text-2xl font-black text-gray-900 mb-3 tracking-tight">Нарушения</h3>
                    <p className="text-sm text-gray-400 font-medium leading-relaxed">
                        Детальный список нарушений регламента и пропусков.
                    </p>
                </Link>

                {/* 3. Quality */}
                <Link href={`/analytics/quality${suffix}`} className="group block p-6 md:p-8 bg-white border border-gray-100 rounded-[32px] md:rounded-[40px] shadow-xl shadow-gray-200/50 hover:shadow-2xl hover:shadow-blue-200/40 hover:-translate-y-1 transition-all">
                    <div className="w-12 h-12 md:w-14 md:h-14 bg-blue-50 rounded-xl md:rounded-2xl flex items-center justify-center mb-6 text-blue-600 group-hover:scale-110 transition-transform">
                        <svg className="w-6 h-6 md:w-7 md:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path>
                        </svg>
                    </div>
                    <h3 className="text-xl md:text-2xl font-black text-gray-900 mb-3 tracking-tight">Качество</h3>
                    <p className="text-sm text-gray-400 font-medium leading-relaxed">
                        Анализ диалогов и распределение по дням/неделям.
                    </p>
                </Link>

                {/* 4. Settings */}
                <Link href="/settings/managers" className="group block p-6 md:p-8 bg-gray-900 rounded-[32px] md:rounded-[40px] shadow-2xl shadow-gray-900/20 hover:bg-blue-600 transition-all">
                    <div className="w-12 h-12 md:w-14 md:h-14 bg-white/10 rounded-xl md:rounded-2xl flex items-center justify-center mb-6 text-white group-hover:scale-110 transition-transform">
                        <svg className="w-6 h-6 md:w-7 md:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path>
                        </svg>
                    </div>
                    <h3 className="text-xl md:text-2xl font-black text-white mb-3 tracking-tight">Настройки</h3>
                    <p className="text-sm text-white/50 font-medium leading-relaxed">
                        Управление списком контролируемых менеджеров.
                    </p>
                </Link>

            </div>
        </div>
    );
}

export default function AnalyticsHub() {
    return (
        <Suspense fallback={<div>Загрузка...</div>}>
            <HubContent />
        </Suspense>
    );
}
