'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getCallTranscript } from '@/app/actions/rules';

function TranscriptSection({ callId }: { callId: string }) {
    const [transcript, setTranscript] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);

    useEffect(() => {
        async function fetchTranscript() {
            setLoading(true);
            try {
                const text = await getCallTranscript(callId);
                setTranscript(text);
            } catch (e) {
                setError(true);
            } finally {
                setLoading(false);
            }
        }
        fetchTranscript();
    }, [callId]);

    return (
        <div className="bg-gray-900 text-gray-200 p-4 rounded-lg border border-gray-800 shadow-inner">
            <h4 className="flex items-center gap-2 font-bold text-gray-400 text-xs uppercase mb-4 tracking-widest border-b border-gray-800 pb-2">
                <span>💬</span> Транскрибация звонка
            </h4>

            {loading ? (
                <div className="flex items-center justify-center py-10 gap-3">
                    <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></div>
                    <span className="text-xs text-gray-500 font-mono uppercase">Загрузка текста...</span>
                </div>
            ) : error ? (
                <div className="text-red-400 text-xs text-center py-4 bg-red-950/20 rounded border border-red-900/30">
                    Ошибка при загрузке транскрибации
                </div>
            ) : transcript ? (
                <div className="max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    <p className="text-sm leading-relaxed whitespace-pre-wrap font-mono selection:bg-indigo-500/30">
                        {transcript}
                    </p>
                </div>
            ) : (
                <div className="text-gray-600 text-xs text-center py-10 font-mono uppercase">
                    Текст звонка не найден
                </div>
            )}
        </div>
    );
}

interface ViolationRowProps {
    violation: any;
}

export default function ViolationRow({ violation: v }: ViolationRowProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [status, setStatus] = useState(v.status || 'pending');
    const [comment, setComment] = useState(v.controller_comment || '');
    const [loading, setLoading] = useState(false);

    const handleFeedback = async (newStatus: 'confirmed' | 'rejected') => {
        setLoading(true);
        try {
            const res = await fetch('/api/analysis/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    violation_id: v.id,
                    status: newStatus,
                    comment: newStatus === 'rejected' ? 'AI Error marked by controller' : 'Confirmed by controller'
                })
            });
            if (res.ok) {
                setStatus(newStatus);
            }
        } catch (e) {
            console.error('Failed to update status', e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <tr
                className={`hover:bg-gray-50 cursor-pointer transition-colors ${isExpanded ? 'bg-indigo-50/50' : ''}`}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <td className="px-4 md:px-6 py-4 whitespace-nowrap text-xs md:text-sm text-gray-500">
                    {new Date(v.violation_time).toLocaleString('ru-RU')}
                </td>
                <td className="px-4 md:px-6 py-4">
                    <span className={`px-2 inline-flex text-[10px] md:text-xs leading-5 font-semibold rounded-full 
                        ${v.severity === 'critical' ? 'bg-red-100 text-red-800' :
                            v.severity === 'high' ? 'bg-orange-100 text-orange-800' :
                                'bg-yellow-100 text-yellow-800'}`}>
                        {v.okk_rules?.name || v.rule_code}
                    </span>
                </td>
                <td className="px-4 md:px-6 py-4 whitespace-nowrap text-xs md:text-sm font-bold text-indigo-600">
                    {v.checklist_result?.totalScore ?? v.points ?? 0}
                </td>
                <td className="px-4 md:px-6 py-4 whitespace-nowrap text-xs md:text-sm text-gray-900">
                    {v.managers ? `${v.managers.first_name || ''} ${v.managers.last_name || ''}`.trim() || 'N/A' : 'N/A'}
                </td>
                <td className="px-4 md:px-6 py-4 text-xs md:text-sm text-gray-500 max-w-[200px]">
                    <div className="flex items-center gap-2">
                        <button
                            className={`p-1 rounded-full hover:bg-gray-200 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsExpanded(!isExpanded);
                            }}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                        <span className="truncate block">
                            {v.details}
                        </span>
                    </div>
                </td>
                <td className="px-4 md:px-6 py-4 whitespace-nowrap text-xs" onClick={(e) => e.stopPropagation()}>
                    {v.order_id ? (
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                                <a href={`https://zmktlt.retailcrm.ru/orders/${v.order_id}/edit`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 font-bold underline">
                                    #{v.orders?.number || v.order_id}
                                </a>
                            </div>
                            {v.orders?.status && (
                                <span className="self-start inline-block px-2 py-0.5 text-[10px] bg-gray-100 border border-gray-200 rounded text-gray-600 font-mono">
                                    {v.orders.status}
                                </span>
                            )}
                        </div>
                    ) : (
                        <span className="text-gray-400">—</span>
                    )}
                </td>
            </tr>

            {/* Expanded Details Row */}
            {isExpanded && (
                <tr className="bg-gray-50/50">
                    <td colSpan={6} className="px-2 md:px-6 py-4 border-b border-indigo-100">
                        <div className="flex flex-col gap-6 pl-2 md:pl-8 py-2">

                            {/* 1. Checklist Detailed Breakdown */}
                            {v.checklist_result && v.checklist_result.sections && (
                                <div className="space-y-4">
                                    <h4 className="flex items-center gap-2 font-bold text-gray-700 text-xs uppercase tracking-wider border-b pb-2">
                                        <span>📋</span> Детальный отчет по чек-листу
                                        <span className="ml-auto bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded shadow-sm">
                                            {v.checklist_result.totalScore} / {v.checklist_result.maxScore}
                                        </span>
                                    </h4>

                                    <div className="grid grid-cols-1 gap-4">
                                        {v.checklist_result.sections.map((section: any, sIdx: number) => (
                                            <div key={sIdx} className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                                                <div className="bg-gray-50 px-3 py-2 border-b flex justify-between items-center">
                                                    <span className="text-xs font-bold text-gray-600 uppercase italic">
                                                        {section.section || `Секция ${sIdx + 1}`}
                                                    </span>
                                                    <span className="text-[10px] text-gray-400">
                                                        {section.sectionScore} / {section.sectionMaxScore}
                                                    </span>
                                                </div>
                                                <div className="divide-y divide-gray-100">
                                                    {section.items && section.items.length > 0 ? (
                                                        section.items.map((item: any, iIdx: number) => (
                                                            <div key={iIdx} className="p-3 flex flex-col gap-2">
                                                                <div className="flex justify-between gap-4">
                                                                    <div className="flex items-start gap-2">
                                                                        <span className={`mt-0.5 shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold
                                                                            ${item.score > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                                            {item.score > 0 ? '✓' : '✕'}
                                                                        </span>
                                                                        <span className="text-sm font-medium text-gray-800 leading-tight">
                                                                            {item.description}
                                                                        </span>
                                                                    </div>
                                                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border self-start
                                                                        ${item.score > 0 ? 'bg-green-50 text-green-600 border-green-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
                                                                        {item.score}
                                                                    </span>
                                                                </div>
                                                                {item.justification && (
                                                                    <p className="text-xs text-gray-500 ml-6 pl-2 border-l-2 border-gray-100 italic">
                                                                        {item.justification}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <div className="p-3 text-[10px] text-gray-400 italic">Нет данных по этой секции</div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* 2. Analysis Summary */}
                            <div className="bg-amber-50 p-4 rounded-lg border border-amber-100 shadow-sm">
                                <h4 className="flex items-center gap-2 font-bold text-amber-800 text-xs uppercase mb-2">
                                    <span>🧠</span> Итоговое резюме ИИ
                                </h4>
                                <p className="text-amber-900 text-sm whitespace-pre-wrap leading-relaxed italic">
                                    {v.checklist_result?.summary || v.details}
                                </p>
                            </div>

                            {/* 3. Call Transcript Viewer */}
                            {v.call_id && (
                                <TranscriptSection callId={v.call_id} />
                            )}

                            <div className="text-[10px] text-gray-400 flex flex-wrap gap-x-6 gap-y-2 mt-2 pt-4 border-t border-gray-100 uppercase tracking-widest">
                                <span>Violation ID: {v.id}</span>
                                <span>Call Event ID: {v.call_id || 'N/A'}</span>
                                <span>Manager: {v.manager_id}</span>
                                <span>Detected: {new Date(v.created_at || v.violation_time).toLocaleString()}</span>
                            </div>

                            {/* Feedback Controller Section */}
                            <div className="mt-4 p-5 bg-white rounded-xl border-2 border-gray-100 shadow-sm relative overflow-hidden">
                                <div className={`absolute top-0 right-0 px-3 py-1 text-[10px] font-bold uppercase rounded-bl-lg border-l border-b
                                    ${status === 'confirmed' ? 'bg-green-500 text-white border-green-600' :
                                        status === 'rejected' ? 'bg-red-500 text-white border-red-600' :
                                            'bg-gray-400 text-white border-gray-500'}`}>
                                    {status === 'confirmed' ? 'Подтверждено' :
                                        status === 'rejected' ? 'Отклонено' :
                                            'Ожидает проверки'}
                                </div>

                                <h4 className="font-bold text-gray-800 text-sm mb-4">Вердикт контролера качества</h4>

                                {status === 'pending' ? (
                                    <div className="flex gap-4">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleFeedback('confirmed'); }}
                                            disabled={loading}
                                            className="group flex items-center justify-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-bold shadow-md shadow-green-100 transition-all disabled:opacity-50"
                                        >
                                            <span className="text-lg group-hover:scale-125 transition-transform">{loading ? '...' : '👍'}</span>
                                            {loading ? 'Обработка...' : 'Все верно'}
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleFeedback('rejected'); }}
                                            disabled={loading}
                                            className="group flex items-center justify-center gap-2 px-6 py-3 bg-white hover:bg-red-50 text-red-600 border-2 border-red-100 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                                        >
                                            <span className="text-lg group-hover:scale-125 transition-transform">{loading ? '...' : '👎'}</span>
                                            {loading ? 'Обработка...' : 'Ошибка ИИ'}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-4 text-sm text-gray-700 font-medium bg-gray-50 p-4 rounded-lg border border-gray-200">
                                        <span className="text-2xl">{status === 'confirmed' ? '✅' : '❌'}</span>
                                        <div>
                                            {status === 'confirmed' ? 'Вы подтвердили, что это нарушение корректно.' : 'Вы пометили данный случай как ложный.'}
                                            {comment && <div className="mt-1 text-gray-500 text-xs italic">Комментарий: "{comment}"</div>}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
