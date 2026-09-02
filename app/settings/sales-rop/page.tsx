'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { SETTING_GROUPS, type SettingKind } from '@/lib/sales-rop/settings-schema';
import { formatIntRu } from '@/lib/format';

// Настройки бота-РОПа.
//
// Раньше их правили только в базе, и это уже стоило расхождения цифр. Экран
// показывает не ключи, а то, что настройка делает: рядом с каждой — объяснение,
// зачем она и что изменится, если сдвинуть.

type Item = {
    key: string;
    title: string;
    hint: string;
    kind: SettingKind;
    group: string;
    unit?: string;
    value: string;
};

type Ref = {
    managers: { id: number; name: string }[];
    statuses: { code: string; name: string; active: boolean; working: boolean }[];
};

export default function SalesRopSettingsPage() {
    const [items, setItems] = useState<Item[]>([]);
    const [refs, setRefs] = useState<Ref>({ managers: [], statuses: [] });
    const [draft, setDraft] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState('');

    const load = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/sales-rop/settings');
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Не удалось загрузить настройки');
            setItems(json.items);
            setRefs({ managers: json.managers ?? [], statuses: json.statuses ?? [] });
            setDraft({});
            setError('');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const valueOf = (it: Item) => draft[it.key] ?? it.value;
    const changed = useMemo(
        () => items.filter((it) => draft[it.key] !== undefined && draft[it.key] !== it.value),
        [items, draft],
    );

    const set = (key: string, value: string) => {
        setSaved('');
        setDraft((d) => ({ ...d, [key]: value }));
    };

    const save = async () => {
        if (changed.length === 0 || saving) return;
        setSaving(true);
        setError('');
        try {
            const res = await fetch('/api/sales-rop/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ changes: changed.map((it) => ({ key: it.key, value: valueOf(it) })) }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Не удалось сохранить');
            setSaved(`Сохранено в ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`);
            await load();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const byGroup = useMemo(() => {
        const map = new Map<string, Item[]>();
        for (const it of items) {
            const list = map.get(it.group) ?? [];
            list.push(it);
            map.set(it.group, list);
        }
        return map;
    }, [items]);

    // Что даст нагрузка: числа считаем прямо здесь, чтобы решение принималось по
    // задачам, а не по абстрактному множителю.
    const loadPreview = useMemo(() => {
        const factor = Number(items.find((i) => i.key === 'load_factor') ? valueOf(items.find((i) => i.key === 'load_factor')!) : 1);
        const target = Number(items.find((i) => i.key === 'daily_target_tasks')?.value ?? 0);
        if (!Number.isFinite(factor) || !target) return null;
        return { factor, base: target, result: Math.max(1, Math.round(target * factor)) };
    }, [items, draft]);

    return (
        <div style={{ padding: '16px 20px' }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, textTransform: 'uppercase', margin: 0 }}>
                Настройки бота-РОПа
            </h1>
            <p style={{ color: '#666', fontSize: 13, margin: '6px 0 16px' }}>
                Утренние планы и вечерний разбор отдела продаж. Изменения применяются к следующему прогону.
            </p>

            {error && (
                <div style={{ background: '#d32f2f', color: '#fff', padding: '8px 12px', marginBottom: 12, fontSize: 13 }}>
                    {error}
                </div>
            )}

            {loading ? (
                <div style={{ color: '#666', fontSize: 13 }}>Загружаем настройки…</div>
            ) : (
                <>
                    {SETTING_GROUPS.filter((g) => (byGroup.get(g) ?? []).length > 0).map((group) => (
                        <section key={group} style={{ marginBottom: 20 }}>
                            <h2
                                style={{
                                    fontSize: 13,
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    letterSpacing: 0.5,
                                    background: '#111',
                                    color: '#fff',
                                    padding: '5px 10px',
                                    margin: '0 0 1px',
                                }}
                            >
                                {group}
                            </h2>

                            {(byGroup.get(group) ?? []).map((it) => (
                                <div
                                    key={it.key}
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'minmax(220px, 320px) 1fr',
                                        gap: 12,
                                        borderBottom: '1px solid #e5e5e5',
                                        padding: '8px 10px',
                                        alignItems: 'start',
                                    }}
                                >
                                    <div>
                                        <div style={{ fontSize: 14, fontWeight: 600 }}>{it.title}</div>
                                        <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>{it.hint}</div>
                                    </div>
                                    <Field
                                        item={it}
                                        value={valueOf(it)}
                                        refs={refs}
                                        onChange={(v) => set(it.key, v)}
                                    />
                                </div>
                            ))}

                            {group === 'Нагрузка отдела' && loadPreview && (
                                <div style={{ fontSize: 13, padding: '8px 10px', background: '#f4f4f4' }}>
                                    При нагрузке ×{loadPreview.factor} норма дня:{' '}
                                    <b>
                                        {formatIntRu(loadPreview.base)} → {formatIntRu(loadPreview.result)} задач
                                    </b>{' '}
                                    на человека.
                                </div>
                            )}
                        </section>
                    ))}

                    <div
                        style={{
                            position: 'sticky',
                            bottom: 0,
                            background: '#fff',
                            borderTop: '1px solid #111',
                            padding: '10px 0',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                        }}
                    >
                        <button
                            onClick={save}
                            disabled={changed.length === 0 || saving}
                            aria-busy={saving}
                            style={{
                                background: changed.length === 0 ? '#ccc' : '#0057d9',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 0,
                                padding: '10px 18px',
                                fontSize: 14,
                                fontWeight: 600,
                                cursor: changed.length === 0 || saving ? 'default' : 'pointer',
                            }}
                        >
                            {saving ? 'Сохраняем…' : `Сохранить настройки${changed.length ? ` (${changed.length})` : ''}`}
                        </button>
                        {saved && <span style={{ fontSize: 13, color: '#2e7d32' }}>{saved}</span>}
                        {changed.length > 0 && !saving && (
                            <span style={{ fontSize: 13, color: '#666' }}>
                                Изменено: {changed.map((c) => c.title).join(', ')}
                            </span>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

const inputStyle: React.CSSProperties = {
    border: '1px solid #999',
    borderRadius: 0,
    padding: '6px 8px',
    fontSize: 14,
    width: '100%',
    maxWidth: 420,
};

function Field({
    item,
    value,
    refs,
    onChange,
}: {
    item: Item;
    value: string;
    refs: Ref;
    onChange: (v: string) => void;
}) {
    if (item.kind === 'toggle') {
        const on = value === 'true';
        return (
            <button
                onClick={() => onChange(on ? 'false' : 'true')}
                style={{
                    background: on ? '#2e7d32' : '#eee',
                    color: on ? '#fff' : '#333',
                    border: '1px solid ' + (on ? '#2e7d32' : '#999'),
                    borderRadius: 0,
                    padding: '6px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    minWidth: 120,
                }}
            >
                {on ? 'Включено' : 'Выключено'}
            </button>
        );
    }

    if (item.kind === 'ids') {
        const picked = new Set(value.split(',').map((x) => x.trim()).filter(Boolean));
        const toggle = (id: number) => {
            const next = new Set(picked);
            const key = String(id);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            onChange(Array.from(next).join(','));
        };
        return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {refs.managers.map((m) => {
                    const on = picked.has(String(m.id));
                    return (
                        <button
                            key={m.id}
                            onClick={() => toggle(m.id)}
                            style={{
                                background: on ? '#0057d9' : '#fff',
                                color: on ? '#fff' : '#333',
                                border: '1px solid ' + (on ? '#0057d9' : '#bbb'),
                                borderRadius: 0,
                                padding: '4px 10px',
                                fontSize: 13,
                                cursor: 'pointer',
                            }}
                        >
                            {m.name}
                        </button>
                    );
                })}
                {picked.size === 0 && <span style={{ fontSize: 12, color: '#777' }}>никто не выбран — значит всем</span>}
            </div>
        );
    }

    if (item.kind === 'codes') {
        const picked = new Set(value.split(',').map((x) => x.trim()).filter(Boolean));
        const toggle = (code: string) => {
            const next = new Set(picked);
            if (next.has(code)) next.delete(code);
            else next.add(code);
            onChange(Array.from(next).join(','));
        };
        // Показываем только живые статусы. Исключение — уже выбранный неактивный:
        // он остаётся в настройке и должен быть виден, чтобы его можно было снять.
        // Бот работает только с «рабочими» статусами — в остальных заказ и так
        // не попадает в план, и галочка там ничего не меняет. Предлагаем только
        // те, где выбор имеет смысл.
        const shown = refs.statuses.filter((s) => (s.active && s.working) || picked.has(s.code));
        const stale = shown.filter((s) => !s.active || !s.working).length;
        return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                {stale > 0 && (
                    <div style={{ width: '100%', fontSize: 12, color: '#b26a00', marginBottom: 2 }}>
                        Оранжевым — статусы, на которые бот и так не смотрит ({stale}): они нерабочие или их больше нет
                        в CRM. Галочка на них ничего не меняет, снять можно смело.
                    </div>
                )}
                {shown.map((s) => {
                    const on = picked.has(s.code);
                    return (
                        <button
                            key={s.code}
                            onClick={() => toggle(s.code)}
                            style={{
                                background: on ? (s.active && s.working ? '#0057d9' : '#b26a00') : '#fff',
                                color: on ? '#fff' : '#333',
                                border: '1px solid ' + (on ? (s.active && s.working ? '#0057d9' : '#b26a00') : '#ddd'),
                                borderRadius: 0,
                                padding: '3px 8px',
                                fontSize: 12,
                                cursor: 'pointer',
                            }}
                        >
                            {s.name}
                            {!s.active ? ' · нет в CRM' : !s.working ? ' · нерабочий' : ''}
                        </button>
                    );
                })}
            </div>
        );
    }

    if (item.kind === 'money') {
        // Суммы — с разделителями разрядов, и в поле тоже.
        const shown = value ? formatIntRu(Number(value.replace(/\s/g, '')) || 0) : '';
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                    value={shown}
                    inputMode="numeric"
                    onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
                    style={{ ...inputStyle, maxWidth: 200, textAlign: 'right' }}
                />
                <span style={{ fontSize: 13, color: '#666' }}>₽</span>
            </div>
        );
    }

    if (item.kind === 'number' || item.kind === 'factor') {
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                    value={value}
                    inputMode="decimal"
                    onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
                    style={{ ...inputStyle, maxWidth: 120, textAlign: 'right' }}
                />
                {item.unit && <span style={{ fontSize: 13, color: '#666' }}>{item.unit}</span>}
            </div>
        );
    }

    return <input value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />;
}
