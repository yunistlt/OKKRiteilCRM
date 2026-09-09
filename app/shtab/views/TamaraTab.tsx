'use client';

import { useState } from 'react';
import type { TamaraState } from '../Tamara';
import { BRIEFS } from '../tamara-briefs';
import type { ViewProps } from '../nav';

const LOOPS: { state: TamaraState; when: string; what: string }[] = [
    { state: 'idle', when: 'по умолчанию', what: 'стоит спокойно, редко меняет опору' },
    { state: 'listening', when: 'ты печатаешь в поле разбора', what: 'повёрнута к тебе, следит' },
    { state: 'thinking', when: 'пауза в наборе, перед вердиктом', what: 'взгляд в сторону, голова ниже' },
    { state: 'object', when: 'проверка вернула «плохо»', what: 'подаётся вперёд, останавливающий жест' },
    { state: 'explain', when: 'проверка вернула «уточни»', what: 'жестикулирует, объясняет' },
    { state: 'approve', when: 'проверка пройдена, шаг закрыт', what: 'кивок, расслабляется' },
    { state: 'alert', when: 'сигнал в статистике на Пульте', what: 'собранная поза, замирает' },
    { state: 'away', when: '90 секунд без действий', what: 'отходит вглубь, к своим бумагам' },
];

export default function TamaraTab({ tamara }: ViewProps) {
    const [copied, setCopied] = useState<string | null>(null);

    const copy = async (id: string, text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(id);
            setTimeout(() => setCopied(null), 1600);
        } catch {
            setCopied(null);
        }
    };

    return (
        <>
            <div className="view-head">
                <div className="eyebrow">Наставник</div>
                <h1>Тамара</h1>
                <p>
                    Женщина, а не карточка с текстом. Стоит слева постоянно, читает то, что ты пишешь, и реагирует
                    телом раньше, чем словами. На первом этапе общается текстом — значит липсинк не нужен, нужны петли
                    языка тела.
                </p>
            </div>

            <div className="block-label">
                <span className="eyebrow">Восемь состояний · переключаются по тому, что ты делаешь</span>
            </div>
            <div className="tablewrap">
                <table>
                    <thead>
                        <tr>
                            <th>Петля</th>
                            <th>Когда включается</th>
                            <th>Что делает</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {LOOPS.map((l) => (
                            <tr key={l.state}>
                                <td>
                                    <code>{l.state}</code>
                                </td>
                                <td>{l.when}</td>
                                <td>{l.what}</td>
                                <td>
                                    <button
                                        className="btn btn-sm"
                                        onClick={() =>
                                            tamara.say(
                                                `Петля «${l.state}»: ${l.what}.`,
                                                'Показ состояния — движение видно на фигуре слева.',
                                                l.state,
                                            )
                                        }
                                    >
                                        показать
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="block-label">
                <span className="eyebrow">Как производить клипы</span>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', maxWidth: '72ch', marginBottom: 14 }}>
                Сейчас фигура — утверждённый статичный кадр, разрезанный на два слоя: тело и голова двигаются
                раздельно. Настоящее движение — моргание, мимика, дыхание грудной клетки — придёт с восемью
                видео-петлями. Первым снимается <code>idle</code>: он играет девяносто процентов времени и задаёт
                характер.
            </p>

            {BRIEFS.map((b) => (
                <div className="brief" key={b.id}>
                    <h3>{b.title}</h3>
                    <p className="hint" style={{ marginTop: 0, marginBottom: 9 }}>
                        {b.note}
                    </p>
                    <textarea readOnly value={b.text} />
                    <div className="row">
                        <button className="btn btn-sm" onClick={() => void copy(b.id, b.text)}>
                            {copied === b.id ? 'скопировано' : 'скопировать'}
                        </button>
                    </div>
                </div>
            ))}
        </>
    );
}
