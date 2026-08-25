'use client';

import { useEffect, useRef, useState } from 'react';
import type { GoalKind } from '@/lib/shtab/types';
import type { ViewProps } from '../nav';

const SAVE_DELAY_MS = 700;

export default function Celi({ shtab }: ViewProps) {
    const { state, saveGoals } = shtab;
    const [draft, setDraft] = useState<Record<GoalKind, string> | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (state && !draft) setDraft({ ...state.goals });
    }, [state, draft]);

    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current);
        },
        [],
    );

    if (!state || !draft) return null;

    const edit = (kind: GoalKind, value: string) => {
        setDraft((prev) => (prev ? { ...prev, [kind]: value } : prev));
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void saveGoals({ [kind]: value }), SAVE_DELAY_MS);
    };

    return (
        <>
            <div className="view-head">
                <div className="eyebrow">Два документа, не один</div>
                <h1>Цели и посты</h1>
                <p>
                    Цель компании и цель владельца разделены: сотрудник не сделает своей целью твою прибыль и твою
                    свободу. Позитивная часть краткосрочной цели берётся только из левого документа.
                </p>
            </div>

            <div className="docs">
                <div className="doc">
                    <div className="eyebrow">Долгосрочная · архитектурная</div>
                    <h3>Цель компании</h3>
                    <div className="doc-meta">видна команде</div>
                    <textarea
                        value={draft.company}
                        onChange={(e) => edit('company', e.target.value)}
                        style={{ minHeight: 230 }}
                        placeholder="Куда идёт компания и каким станет положение дел, когда она туда придёт"
                    />
                </div>
                <div className="doc private">
                    <div className="eyebrow">
                        <span className="lock">приватно</span> · только владелец
                    </div>
                    <h3>Цель владельца</h3>
                    <div className="doc-meta">не показывается команде</div>
                    <textarea
                        value={draft.owner}
                        onChange={(e) => edit('owner', e.target.value)}
                        style={{ minHeight: 230 }}
                        placeholder="Чего хочешь ты сам — то, что не годится ставить целью сотруднику"
                    />
                </div>
            </div>

            <div className="block-label">
                <span className="eyebrow">Ценный конечный продукт компании</span>
            </div>
            <div className="card">
                <textarea
                    value={draft.product}
                    onChange={(e) => edit('product', e.target.value)}
                    style={{ minHeight: 88 }}
                    placeholder="Что компания отдаёт наружу в законченном виде, за что ей платят"
                />
            </div>

            <div className="block-label">
                <span className="eyebrow">Посты · образцовое положение и статистики</span>
            </div>
            <div className="empty">
                Посты пока не заведены. Пост — это не сотрудник: у него своё образцовое положение дел и своя
                еженедельная статистика, и один человек может занимать несколько постов. Отдельный экран под них — в
                следующем заходе, вместе с проектами.
            </div>
        </>
    );
}
