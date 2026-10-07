'use client';

import { useRef, useState } from 'react';

/**
 * Загрузка банковской выписки файлом — для банков, с которыми обмена нет.
 *
 * Решение владельца 07.10.2026. Счёт ООО «ЗМК» в ВТБ к обмену не подключён, и
 * поступления на него в ОКК не приходят вовсе: за сентябрь так прошло пять
 * платежей, два из них пришлось разносить руками.
 *
 * Загруженные платежи идут обычным путём: сопоставляются с заказами по номеру
 * счёта в назначении и разносятся тем же механизмом, что и поступления из
 * Точки. Повторная загрузка той же выписки дублей не создаёт.
 */
export default function StatementUpload() {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);

    const upload = async (file: File) => {
        setBusy(true);
        setProblem(null);
        setResult(null);
        try {
            const body = new FormData();
            body.append('file', file);
            body.append('source', 'vtb');

            const res = await fetch('/api/payments/upload-statement', { method: 'POST', body });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || 'Выписка не загрузилась');
            setResult(payload);
        } catch (e: any) {
            setProblem(e.message);
        } finally {
            setBusy(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    return (
        <div className="border-t border-gray-200">
            <button
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50"
            >
                <span className="text-sm font-semibold">📄 Загрузить выписку из банка</span>
                <span className="text-gray-400">{open ? '▲' : '▼'}</span>
            </button>

            {open && (
                <div className="space-y-3 border-t border-gray-100 bg-gray-50 px-4 py-3">
                    <p className="text-sm text-gray-600">
                        Для банков, с которыми у нас нет обмена — например, счёт ЗМК в ВТБ.
                        Выгрузите в клиент-банке выписку в формате обмена с 1С
                        («1CClientBankExchange») и загрузите файл сюда. Поступления сами
                        встанут в очередь на разнос по заказам.
                    </p>

                    <input
                        ref={fileRef}
                        type="file"
                        accept=".txt,.1c,text/plain"
                        disabled={busy}
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void upload(file);
                        }}
                        className="block w-full border border-gray-300 bg-white px-3 py-2 text-sm"
                    />

                    {busy && <p className="text-sm text-gray-500">Читаем выписку…</p>}
                    {problem && (
                        <div className="border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                            {problem}
                        </div>
                    )}

                    {result && (
                        <div className="border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
                            <div className="font-semibold">{result.note}</div>
                            <div className="mt-1 text-[13px] text-green-800">
                                Счёт {result.account ?? '—'}
                                {result.period ? ` · период ${result.period}` : ''}
                                {' · '}документов {result.всегоДокументов}, из них поступлений {result.поступлений}
                                {result.ужеБыли ? ` · уже были ${result.ужеБыли}` : ''}
                            </div>
                            {Array.isArray(result.пропущено) && result.пропущено.length > 0 && (
                                <ul className="mt-2 list-disc pl-5 text-[13px] text-amber-800">
                                    {result.пропущено.map((p: string, i: number) => <li key={i}>{p}</li>)}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
