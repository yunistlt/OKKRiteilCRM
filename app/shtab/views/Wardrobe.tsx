'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Гардероб Тамары — правится владельцем, не разработчиком.
 *
 * На экране две разные вещи, и их важно не путать. Общая часть задания отвечает
 * за то, что на кадре та же женщина, снятая так же, — её трогают редко и с
 * осторожностью. Задание образа отвечает за одежду, и вот его правят постоянно:
 * «слишком мешковато», «каблук ниже», «цвет другой».
 *
 * Условия рядом с заданием, а не отдельной настройкой: решение «пуховик — от
 * минус пяти» принимается ровно тогда, когда смотришь на пуховик.
 */

type Look = {
    id: number;
    slug: string;
    title: string;
    image_url: string;
    prompt: string;
    season: string;
    weekday: string;
    temp_min: number | null;
    temp_max: number | null;
    rain: boolean | null;
    active: boolean;
};

const SEASONS: Array<[string, string]> = [
    ['any', 'любой сезон'],
    ['zima', 'зима'],
    ['vesna', 'весна'],
    ['leto', 'лето'],
    ['osen', 'осень'],
];

const WEEKDAYS: Array<[string, string]> = [
    ['any', 'любой день'],
    ['budni', 'будни'],
    ['pyatnitsa', 'пятница'],
    ['vyhodnoy', 'выходной'],
];

const RAINS: Array<[string, string]> = [
    ['', 'дождь не важен'],
    ['true', 'только в дождь'],
    ['false', 'только без дождя'],
];

function numOrNull(v: string): number | null {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n) : null;
}

export default function Wardrobe() {
    const [looks, setLooks] = useState<Look[]>([]);
    const [basePrompt, setBasePrompt] = useState('');
    const [enabled, setEnabled] = useState(true);
    const [elementId, setElementId] = useState('');
    // Ночная отрисовка живёт на ключах Kling. Пока их нет — это заглушка, и
    // она должна быть видна, а не выясняться по тому, что образы не меняются.
    const [drawReady, setDrawReady] = useState(false);
    const [drawError, setDrawError] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/shtab/tamara/wardrobe');
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data?.error || 'Гардероб не открылся');
            setLooks(data.wardrobe ?? []);
            setBasePrompt(data.basePrompt ?? '');
            setElementId(data.elementId ?? '');
            setEnabled(Boolean(data.enabled));
            setDrawReady(Boolean(data.drawConfigured));
            setDrawError(String(data.drawError ?? ''));
        } catch (e) {
            setNote((e as Error).message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const patch = (id: number, fields: Partial<Look>) =>
        setLooks((prev) => prev.map((l) => (l.id === id ? { ...l, ...fields } : l)));

    const save = async () => {
        setSaving(true);
        setNote(null);
        try {
            const res = await fetch('/api/shtab/tamara/wardrobe', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enabled,
                    basePrompt,
                    looks: looks.map((l) => ({
                        id: l.id,
                        prompt: l.prompt,
                        season: l.season,
                        weekday: l.weekday,
                        temp_min: l.temp_min,
                        temp_max: l.temp_max,
                        rain: l.rain,
                        active: l.active,
                    })),
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data?.error || 'Не сохранилось');
            setNote('Сохранено');
            setTimeout(() => setNote(null), 2000);
        } catch (e) {
            setNote((e as Error).message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <p className="hint">Открываю гардероб…</p>;

    return (
        <>
            <div className="block-label">
                <span className="eyebrow">Гардероб · во что она одевается каждый день</span>
            </div>

            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', maxWidth: '72ch', marginBottom: 14 }}>
                Ночью из гардероба выбирается образ на день: по сезону, дню недели и погоде в Тольятти, а из
                подходящих — тот, что дольше всех не надевался. Задания правятся здесь; новые образы шьются
                отдельно и попадают сюда только после того, как ты их принял.
            </p>

            {!drawReady ? (
                <p className="hint" style={{ marginBottom: 14, color: 'var(--warn, #a34)' }}>
                    Ночная отрисовка не работает: нет ключей Kling (KLING_ACCESS_KEY и KLING_SECRET_KEY в
                    переменных Vercel). Пока их нет, каждое утро берётся новый образ из уже принятых, но новых
                    кадров не рисуется.
                </p>
            ) : drawError ? (
                <p className="hint" style={{ marginBottom: 14, color: 'var(--warn, #a34)' }}>
                    Сегодня ночью нарисовать не вышло: {drawError}. Показан принятый кадр.
                </p>
            ) : null}

            <div className="row" style={{ marginBottom: 14, gap: 12, alignItems: 'center' }}>
                <label className="row" style={{ gap: 7, alignItems: 'center' }}>
                    <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                    менять одежду каждый день
                </label>
                <button className="btn btn-sm" onClick={() => void save()} disabled={saving}>
                    {saving ? 'сохраняю…' : 'сохранить'}
                </button>
                {note ? <span className="hint">{note}</span> : null}
            </div>

            <div className="brief">
                <h3>Общая часть задания</h3>
                <p className="hint" style={{ marginTop: 0, marginBottom: 9 }}>
                    Отвечает не за одежду, а за то, что на кадре та же женщина и снята так же. Правь осторожно:
                    именно этим держится одно лицо изо дня в день.
                    {elementId ? ` Постоянный субъект Kling: ${elementId}.` : ''}
                </p>
                <textarea value={basePrompt} onChange={(e) => setBasePrompt(e.target.value)} rows={5} />
            </div>

            {looks.length === 0 ? (
                <p className="hint">Гардероб пуст — пока показывается прежняя фигура.</p>
            ) : null}

            {looks.map((l) => (
                <div className="brief" key={l.id}>
                    <h3>{l.title}</h3>
                    <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
                        {/* Картинка рядом с заданием: правку формулировки делают,
                            глядя на то, что из неё вышло. */}
                        <img
                            src={l.image_url}
                            alt={l.title}
                            style={{ width: 96, border: '1px solid var(--line)', flex: '0 0 auto' }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <textarea
                                value={l.prompt}
                                onChange={(e) => patch(l.id, { prompt: e.target.value })}
                                rows={4}
                                placeholder="во что одета: ткани, цвет, длина, обувь"
                            />
                            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                                <select value={l.season} onChange={(e) => patch(l.id, { season: e.target.value })}>
                                    {SEASONS.map(([v, t]) => (
                                        <option key={v} value={v}>
                                            {t}
                                        </option>
                                    ))}
                                </select>
                                <select value={l.weekday} onChange={(e) => patch(l.id, { weekday: e.target.value })}>
                                    {WEEKDAYS.map(([v, t]) => (
                                        <option key={v} value={v}>
                                            {t}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    style={{ width: 92 }}
                                    placeholder="от °C"
                                    value={l.temp_min ?? ''}
                                    onChange={(e) => patch(l.id, { temp_min: numOrNull(e.target.value) })}
                                />
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    style={{ width: 92 }}
                                    placeholder="до °C"
                                    value={l.temp_max ?? ''}
                                    onChange={(e) => patch(l.id, { temp_max: numOrNull(e.target.value) })}
                                />
                                <select
                                    value={l.rain === null ? '' : String(l.rain)}
                                    onChange={(e) =>
                                        patch(l.id, { rain: e.target.value === '' ? null : e.target.value === 'true' })
                                    }
                                >
                                    {RAINS.map(([v, t]) => (
                                        <option key={v} value={v}>
                                            {t}
                                        </option>
                                    ))}
                                </select>
                                <label className="row" style={{ gap: 6, alignItems: 'center' }}>
                                    <input
                                        type="checkbox"
                                        checked={l.active}
                                        onChange={(e) => patch(l.id, { active: e.target.checked })}
                                    />
                                    в обращении
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </>
    );
}
