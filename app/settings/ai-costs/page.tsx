import Link from 'next/link';
import { supabase } from '@/utils/supabase';
import { AGENT_PROFILES } from '@/lib/agents-catalog';
import { getAgentCosts, getUsdToRub } from '@/lib/ai-usage';
import { formatRub, formatIntRu } from '@/lib/format';
import AiCostsEditor from './AiCostsEditor';

export const dynamic = 'force-dynamic';

// Человеческие имена для служебных категорий (вне каталога персон).
const SERVICE_NAMES: Record<string, string> = {
    transcription: 'Транскрибация (служебное)',
    embeddings: 'Эмбеддинги / RAG (служебное)',
    sales_outreach: 'Письма по заказам (продажи)',
};

function agentName(id: string): string {
    return AGENT_PROFILES.find((a) => a.id === id)?.name || SERVICE_NAMES[id] || id;
}

export default async function AiCostsPage() {
    const [costs, fx, { data: pricing }] = await Promise.all([
        getAgentCosts(),
        getUsdToRub(),
        supabase.from('ai_model_pricing').select('model, input_per_1m, cached_input_per_1m, output_per_1m, note').order('model'),
    ]);

    const monthLabel = new Date().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    const rows = Object.entries(costs)
        .map(([id, c]) => ({ id, name: agentName(id), ...c }))
        .sort((a, b) => b.costUsd - a.costUsd);
    const totalUsd = rows.reduce((s, r) => s + r.costUsd, 0);

    return (
        <div className="min-h-[calc(100vh-4rem)] bg-slate-50 px-6 py-8 md:px-8">
            <div className="mb-6 flex items-center gap-4">
                <Link href="/agents" className="text-sm font-bold text-slate-500 hover:text-slate-800">← Все агенты</Link>
            </div>

            <h1 className="text-3xl font-black tracking-tight text-slate-950">Расходы на ИИ</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Фактическая стоимость каждого ИИ-агента — «зарплата ИИ». Считается по токенам каждого вызова модели
                и тарифам ниже, переводится в рубли по курсу. За {monthLabel}.
            </p>

            {/* Ведомость по агентам */}
            <section className="mt-6 border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between">
                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Ведомость за {monthLabel}</div>
                    <div className="text-sm font-black text-slate-900">Итого: {formatRub(totalUsd * fx)} <span className="text-xs font-normal text-slate-400">(${totalUsd.toFixed(2)})</span></div>
                </div>
                <table className="mt-4 w-full text-left text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
                            <th className="py-2 pr-4">Агент</th>
                            <th className="py-2 pr-4 text-right">Вызовов</th>
                            <th className="py-2 pr-4 text-right">Токенов</th>
                            <th className="py-2 pr-4 text-right">USD</th>
                            <th className="py-2 pr-4 text-right">Стоимость, ₽</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.id} className="border-b border-slate-50">
                                <td className="py-2 pr-4 font-bold text-slate-800">{r.name}</td>
                                <td className="py-2 pr-4 text-right text-slate-700">{formatIntRu(r.calls)}</td>
                                <td className="py-2 pr-4 text-right text-slate-700">{formatIntRu(r.promptTokens + r.completionTokens)}</td>
                                <td className="py-2 pr-4 text-right text-slate-500">${r.costUsd.toFixed(2)}</td>
                                <td className="py-2 pr-4 text-right font-black text-slate-900">{formatRub(r.costUsd * fx)}</td>
                            </tr>
                        ))}
                        {rows.length === 0 ? (
                            <tr><td colSpan={5} className="py-6 text-center text-slate-500">Расходов за период пока нет.</td></tr>
                        ) : null}
                    </tbody>
                </table>
            </section>

            {/* Редактор курса и тарифов */}
            <section className="mt-6">
                <div className="mb-3 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Настройки</div>
                <AiCostsEditor initialFx={fx} initialPricing={pricing || []} />
            </section>
        </div>
    );
}
