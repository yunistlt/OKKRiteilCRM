'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface PricingRow {
    model: string;
    input_per_1m: number;
    cached_input_per_1m: number;
    output_per_1m: number;
    note?: string | null;
}

export default function AiCostsEditor({ initialFx, initialPricing }: { initialFx: number; initialPricing: PricingRow[] }) {
    const router = useRouter();
    const [fx, setFx] = useState(String(initialFx));
    const [rows, setRows] = useState<PricingRow[]>(initialPricing);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    const setCell = (model: string, key: keyof PricingRow, val: string) =>
        setRows((rs) => rs.map((r) => (r.model === model ? { ...r, [key]: val } : r)));

    async function save() {
        setSaving(true);
        setMsg(null);
        try {
            const res = await fetch('/api/settings/ai-costs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    usd_to_rub: Number(fx),
                    pricing: rows.map((r) => ({
                        model: r.model,
                        input_per_1m: Number(r.input_per_1m),
                        cached_input_per_1m: Number(r.cached_input_per_1m),
                        output_per_1m: Number(r.output_per_1m),
                    })),
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Ошибка сохранения');
            setMsg({ kind: 'ok', text: 'Сохранено' });
            router.refresh();
        } catch (e: any) {
            setMsg({ kind: 'err', text: e?.message || 'Ошибка' });
        } finally {
            setSaving(false);
        }
    }

    const inputCls = 'w-28 border border-slate-300 px-2 py-1 text-sm text-slate-900 outline-none focus:border-sky-500';

    return (
        <div>
            <div className="flex flex-wrap items-end gap-4 border border-slate-200 bg-white p-5">
                <div>
                    <label className="block text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Курс USD → RUB</label>
                    <input value={fx} onChange={(e) => setFx(e.target.value)} inputMode="decimal" className={`${inputCls} mt-2 w-40 text-lg font-bold`} />
                </div>
                <div className="text-xs text-slate-500">Курс применяется к отображению стоимости всех агентов. Стоимость в USD фиксируется на момент вызова.</div>
            </div>

            <div className="mt-5 overflow-x-auto border border-slate-200 bg-white p-5">
                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Тарифы моделей (USD за 1М токенов)</div>
                <table className="mt-4 w-full text-left text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
                            <th className="py-2 pr-4">Модель</th>
                            <th className="py-2 pr-4">Вход</th>
                            <th className="py-2 pr-4">Кэш-вход</th>
                            <th className="py-2 pr-4">Выход</th>
                            <th className="py-2 pr-4">Примечание</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.model} className="border-b border-slate-50">
                                <td className="py-2 pr-4 font-mono text-xs font-bold text-slate-800">{r.model}</td>
                                <td className="py-2 pr-4"><input value={r.input_per_1m} onChange={(e) => setCell(r.model, 'input_per_1m', e.target.value)} inputMode="decimal" className={inputCls} /></td>
                                <td className="py-2 pr-4"><input value={r.cached_input_per_1m} onChange={(e) => setCell(r.model, 'cached_input_per_1m', e.target.value)} inputMode="decimal" className={inputCls} /></td>
                                <td className="py-2 pr-4"><input value={r.output_per_1m} onChange={(e) => setCell(r.model, 'output_per_1m', e.target.value)} inputMode="decimal" className={inputCls} /></td>
                                <td className="py-2 pr-4 text-xs text-slate-400">{r.note}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="mt-5 flex items-center gap-3">
                <button onClick={save} disabled={saving} className="border border-slate-900 bg-slate-900 px-5 py-2 text-sm font-black uppercase tracking-wider text-white hover:bg-slate-800 disabled:opacity-50">
                    {saving ? 'Сохраняю…' : 'Сохранить'}
                </button>
                {msg ? <span className={`text-sm font-bold ${msg.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{msg.text}</span> : null}
            </div>
        </div>
    );
}
