'use client';

import { useState } from 'react';
import Link from 'next/link';

interface ViolationRowProps {
    violation: any;
}

export default function ViolationRow({ violation: v }: ViolationRowProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <>
            <tr
                className={`hover:bg-gray-50 cursor-pointer transition-colors ${isExpanded ? 'bg-indigo-50/50' : ''}`}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <td className="px-4 md:px-6 py-4 whitespace-nowrap text-xs md:text-sm text-gray-500">
                    {new Date(v.violation_time).toLocaleString('ru-RU')}
                </td>
                <td className="px-4 md:px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                        <span className={`px-2 inline-flex text-[10px] md:text-xs leading-5 font-semibold rounded-full 
                            ${v.severity === 'critical' ? 'bg-red-100 text-red-800' :
                                v.severity === 'high' ? 'bg-orange-100 text-orange-800' :
                                    'bg-yellow-100 text-yellow-800'}`}>
                            {v.okk_rules?.name || v.rule_code}
                        </span>
                    </div>
                </td>
                <td className="px-4 md:px-6 py-4 whitespace-nowrap text-xs md:text-sm text-gray-900">
                    {v.managers ? `${v.managers.first_name || ''} ${v.managers.last_name || ''}`.trim() || 'N/A' : 'N/A'}
                </td>
                <td className="px-4 md:px-6 py-4 text-xs md:text-sm text-gray-500 max-w-xs">
                    <div className="flex items-center gap-2">
                        <button
                            className={`p-1 rounded-full hover:bg-gray-200 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
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
                                {v.orders?.totalsumm && (
                                    <span className="text-gray-600 font-medium">
                                        {v.orders.totalsumm.toLocaleString('ru-RU')} ₽
                                    </span>
                                )}
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
                    <td colSpan={6} className="px-4 md:px-6 py-4 border-b border-indigo-100">
                        <div className="flex flex-col gap-4 pl-4 md:pl-12">
                            {/* Analysis Logic / Reasoning */}
                            <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                                <h4 className="flex items-center gap-2 font-bold text-gray-700 text-xs uppercase mb-2 border-b pb-2">
                                    <span>🧠</span> Аргументация ИИ (Почему это нарушение?)
                                </h4>
                                <p className="text-gray-800 text-sm whitespace-pre-wrap leading-relaxed">
                                    {v.details}
                                </p>
                            </div>

                            {/* Evidence / Quote */}
                            {v.evidence_text && (
                                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 relative overflow-hidden">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-blue-400"></div>
                                    <h4 className="font-bold text-blue-800 text-xs uppercase mb-2">
                                        Цитата из текста / транскрипта:
                                    </h4>
                                    <blockquote className="text-blue-900 italic text-sm font-serif">
                                        "{v.evidence_text}"
                                    </blockquote>
                                </div>
                            )}

                            {/* Timestamps & Technical Info */}
                            <div className="text-xs text-gray-400 flex gap-4 mt-2">
                                <span>ID: {v.id}</span>
                                <span>Call ID: {v.call_id || 'N/A'}</span>
                                <span>Detected At: {new Date(v.created_at || v.violation_time).toLocaleString()}</span>
                            </div>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}
