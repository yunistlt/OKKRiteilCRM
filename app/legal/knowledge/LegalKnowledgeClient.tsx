'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Правила юротдела — то, по чему ИИ-юрисконсульт проверяет договор.
 *
 * Выведены из разбора наших же договоров, поэтому у каждого правила показано
 * основание: на чём оно замечено. Правило можно поправить, выключить или
 * добавить своё — без выкатки, прямо отсюда.
 */
type Rule = {
    id: number;
    topic: string;
    rule: string;
    severity: 'red' | 'watch' | 'norm';
    evidence: string | null;
    isActive: boolean;
    createdBy: string | null;
    updatedAt: string | null;
};

const SEVERITY: Record<Rule['severity'], { label: string; cls: string }> = {
    red: { label: 'Красная линия', cls: 'border-red-600 text-red-700' },
    watch: { label: 'Насторожиться', cls: 'border-amber-600 text-amber-700' },
    norm: { label: 'Наша норма', cls: 'border-emerald-600 text-emerald-700' },
};

const EMPTY: Omit<Rule, 'id' | 'createdBy' | 'updatedAt'> = {
    topic: '', rule: '', severity: 'watch', evidence: null, isActive: true,
};

export default function LegalKnowledgeClient() {
    const [rules, setRules] = useState<Rule[]>([]);
    const [loading, setLoading] = useState(true);
    const [note, setNote] = useState<string | null>(null);
    const [editId, setEditId] = useState<number | 'new' | null>(null);
    const [draft, setDraft] = useState(EMPTY);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/legal/knowledge');
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Не удалось загрузить');
            setRules(json.rules || []);
        } catch (e: any) {
            setNote(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const save = async () => {
        setSaving(true);
        setNote(null);
        try {
            const res = await fetch('/api/legal/knowledge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...draft, id: editId === 'new' ? undefined : editId }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Не сохранилось');
            setEditId(null);
            setDraft(EMPTY);
            await load();
            setNote('Сохранено. Следующая проверка договора пойдёт уже по новому правилу.');
        } catch (e: any) {
            setNote(e.message);
        } finally {
            setSaving(false);
        }
    };

    const toggle = async (row: Rule) => {
        await fetch('/api/legal/knowledge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...row, isActive: !row.isActive }),
        });
        await load();
    };

    const topics = Array.from(new Set(rules.map((r) => r.topic)));

    return (
        <div className="mx-auto max-w-4xl p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                <div>
                    <h1 className="text-xl font-black">Правила юротдела</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        По ним ИИ-юрисконсульт проверяет каждый договор. Правило выключается, правится и
                        добавляется прямо здесь — выкатка не нужна.
                    </p>
                </div>
                <button
                    onClick={() => { setEditId('new'); setDraft(EMPTY); }}
                    className="border border-gray-900 bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white"
                >
                    Добавить правило
                </button>
            </div>

            {note && <div className="mb-3 border-l-[3px] border-l-blue-600 bg-blue-50 px-3 py-2 text-sm text-blue-900">{note}</div>}

            {editId !== null && (
                <div className="mb-4 border border-gray-300 bg-white p-3">
                    <div className="grid gap-2 md:grid-cols-[1fr_1fr]">
                        <label className="text-sm">
                            <span className="mb-1 block text-gray-600">Раздел договора</span>
                            <input
                                value={draft.topic}
                                onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
                                placeholder="Оплата, Неустойка, Подсудность…"
                                className="w-full border border-gray-300 px-2 py-1"
                            />
                        </label>
                        <label className="text-sm">
                            <span className="mb-1 block text-gray-600">Насколько строго</span>
                            <select
                                value={draft.severity}
                                onChange={(e) => setDraft({ ...draft, severity: e.target.value as Rule['severity'] })}
                                className="w-full border border-gray-300 px-2 py-1"
                            >
                                <option value="red">Красная линия — так подписывать нельзя</option>
                                <option value="watch">Повод насторожиться — показать юристу</option>
                                <option value="norm">Наша норма — отклонение стоит объяснить</option>
                            </select>
                        </label>
                    </div>
                    <label className="mt-2 block text-sm">
                        <span className="mb-1 block text-gray-600">Правило — человеческим языком</span>
                        <textarea
                            value={draft.rule}
                            onChange={(e) => setDraft({ ...draft, rule: e.target.value })}
                            rows={3}
                            placeholder="Неустойка без потолка — красная линия. Потолок должен быть в тексте, обычный для нас — 10%."
                            className="w-full border border-gray-300 px-2 py-1"
                        />
                    </label>
                    <label className="mt-2 block text-sm">
                        <span className="mb-1 block text-gray-600">Основание — откуда правило (необязательно)</span>
                        <input
                            value={draft.evidence ?? ''}
                            onChange={(e) => setDraft({ ...draft, evidence: e.target.value })}
                            placeholder="Потолок 10% встречается в 23 наших договорах"
                            className="w-full border border-gray-300 px-2 py-1"
                        />
                    </label>
                    <div className="mt-2 flex items-center gap-3">
                        <button onClick={save} disabled={saving} className="border border-gray-900 bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                            {saving ? 'Сохраняю…' : 'Сохранить'}
                        </button>
                        <button onClick={() => { setEditId(null); setDraft(EMPTY); }} className="text-sm font-semibold text-gray-600 hover:underline">
                            Отменить
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <p className="p-6 text-sm text-gray-500">Загружаю…</p>
            ) : rules.length === 0 ? (
                <p className="border border-dashed p-8 text-center text-sm text-gray-500">Правил пока нет.</p>
            ) : (
                topics.map((topic) => (
                    <section key={topic} className="mb-4">
                        <h2 className="mb-2 border-b border-gray-200 pb-1 text-sm font-bold uppercase tracking-wide text-gray-700">{topic}</h2>
                        {rules.filter((r) => r.topic === topic).map((row) => (
                            <div key={row.id} className={`mb-2 border bg-white p-3 ${row.isActive ? 'border-gray-200' : 'border-gray-200 opacity-50'}`}>
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                    <span className={`border px-2 py-0.5 text-[11px] font-semibold uppercase ${SEVERITY[row.severity].cls}`}>
                                        {SEVERITY[row.severity].label}
                                    </span>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => { setEditId(row.id); setDraft({ topic: row.topic, rule: row.rule, severity: row.severity, evidence: row.evidence, isActive: row.isActive }); }}
                                            className="text-[11px] font-bold text-blue-700 hover:underline"
                                        >
                                            Править
                                        </button>
                                        <button onClick={() => void toggle(row)} className="text-[11px] font-bold text-gray-500 hover:underline">
                                            {row.isActive ? 'Выключить' : 'Включить'}
                                        </button>
                                    </div>
                                </div>
                                <p className="mt-2 text-sm text-gray-900">{row.rule}</p>
                                {row.evidence && <p className="mt-1 text-xs text-gray-500">Основание: {row.evidence}</p>}
                                {!row.isActive && <p className="mt-1 text-xs text-amber-700">Выключено — в проверку договоров не идёт.</p>}
                            </div>
                        ))}
                    </section>
                ))
            )}
        </div>
    );
}
