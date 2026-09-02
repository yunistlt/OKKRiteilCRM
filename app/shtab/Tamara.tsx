'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Наставница слева: стоит постоянно, реагирует телом на то, что владелец пишет,
// и говорит текстом. Липсинка нет и не планируется на этом этапе — общение
// текстовое, поэтому нужны только петли языка тела.
//
// Фигура собрана двумя слоями (тело и голова) из одного снимка. Слои двигаются
// раздельно, потому что голова — то, что глаз считывает как «живая». Нарезка
// делается scripts/shtab-cut-tamara-layers.py; там же лежит объяснение, почему
// растушёвка на шее односторонняя.

export type TamaraState = 'idle' | 'listening' | 'thinking' | 'object' | 'explain' | 'approve' | 'alert' | 'away';

export type TamaraMessage = {
    text: string;
    why?: string;
    state: TamaraState;
};

const ROLE_TITLES: Partial<Record<TamaraState, string>> = {
    object: 'поправка',
    approve: 'принято',
    alert: 'внимание',
};

/** Через сколько без единого действия она отходит к своим бумагам. */
const AWAY_AFTER_MS = 90_000;

/** Сколько последних реплик держать в хвосте пузыря. */
const LOG_DEPTH = 5;

export type TamaraController = {
    say: (text: string, why: string | undefined, state: TamaraState) => void;
    /**
     * Реплика только на смену вердикта. Без этого она заговаривала бы на каждый
     * набранный символ: проверки пересчитываются на каждый рендер.
     */
    reactive: (key: string, verdict: { kind: string; say: string; why: string } | null) => void;
};

export function useTamara(): TamaraController & { node: TamaraView } {
    const [state, setState] = useState<TamaraState>('idle');
    const [message, setMessage] = useState<TamaraMessage | null>(null);
    const [log, setLog] = useState<string[]>([]);
    const [typing, setTyping] = useState(true);

    const queue = useRef<TamaraMessage[]>([]);
    const busy = useRef(false);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const seen = useRef<Record<string, string>>({});
    const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const later = useCallback((fn: () => void, ms: number) => {
        const id = setTimeout(fn, ms);
        timers.current.push(id);
        return id;
    }, []);

    const pump = useCallback(() => {
        if (busy.current || queue.current.length === 0) return;
        busy.current = true;
        const m = queue.current.shift() as TamaraMessage;

        setState('thinking');
        setTyping(true);
        later(() => {
            setState(m.state);
            setTyping(false);
            setMessage(m);
            setLog((prev) => [m.text, ...prev].slice(0, LOG_DEPTH));
            // Пауза пропорциональна длине: короткую реплику незачем держать
            // на экране столько же, сколько абзац.
            later(
                () => {
                    busy.current = false;
                    if (queue.current.length) pump();
                    else setState('idle');
                },
                Math.min(9000, 2400 + m.text.length * 20),
            );
        }, 700);
    }, [later]);

    const say = useCallback(
        (text: string, why: string | undefined, nextState: TamaraState) => {
            queue.current.push({ text, why, state: nextState });
            // Очередь короткая: если владелец быстро правит текст, важна
            // последняя реакция, а не вся история промахов.
            if (queue.current.length > 3) queue.current = queue.current.slice(-3);
            pump();
        },
        [pump],
    );

    const reactive = useCallback<TamaraController['reactive']>(
        (key, verdict) => {
            if (!verdict) {
                delete seen.current[key];
                return;
            }
            const signature = `${key}|${verdict.kind}|${verdict.say.slice(0, 42)}`;
            if (seen.current[key] === signature) return;
            seen.current[key] = signature;
            say(verdict.say, verdict.why, verdict.kind === 'bad' ? 'object' : verdict.kind === 'warn' ? 'explain' : 'approve');
        },
        [say],
    );

    // Отошла — если владелец полторы минуты ничего не делает. Возвращается на
    // первое же действие.
    useEffect(() => {
        const nudge = () => {
            if (idleTimer.current) clearTimeout(idleTimer.current);
            setState((s) => (s === 'away' ? 'idle' : s));
            idleTimer.current = setTimeout(() => {
                if (!busy.current) setState('away');
            }, AWAY_AFTER_MS);
        };
        document.addEventListener('pointerdown', nudge);
        document.addEventListener('keydown', nudge);
        nudge();
        return () => {
            document.removeEventListener('pointerdown', nudge);
            document.removeEventListener('keydown', nudge);
            if (idleTimer.current) clearTimeout(idleTimer.current);
        };
    }, []);

    useEffect(() => {
        const pending = timers.current;
        return () => {
            pending.forEach(clearTimeout);
        };
    }, []);

    return { say, reactive, node: { state, message, log, typing } };
}

export type TamaraView = {
    state: TamaraState;
    message: TamaraMessage | null;
    log: string[];
    typing: boolean;
};

export default function Tamara({
    view,
    onAsk,
    busy,
}: {
    view: TamaraView;
    /** Вопрос владельца. Без обработчика поле ввода не показывается. */
    onAsk?: (question: string) => void;
    busy?: boolean;
}) {
    const { state, message, log, typing } = view;
    const [draft, setDraft] = useState('');

    const ask = () => {
        const text = draft.trim();
        if (!text || busy || !onAsk) return;
        onAsk(text);
        setDraft('');
    };

    return (
        <aside className="tam" data-state={state}>
            <div className="bubble">
                <div className="b-name">
                    <b>Тамара</b>
                    <span className="eyebrow">{ROLE_TITLES[state] ?? 'наставник'}</span>
                </div>
                <div className="b-text">
                    {typing || !message ? (
                        <span className="dots">
                            <i />
                            <i />
                            <i />
                        </span>
                    ) : (
                        message.text
                    )}
                </div>
                {!typing && message?.why ? <div className="b-why">{message.why}</div> : null}
                <div className="b-log">
                    {log.slice(1).map((text, i) => (
                        <div key={`${i}-${text.slice(0, 24)}`}>· {text}</div>
                    ))}
                </div>
            </div>

            <div className="stage">
                <div className="loop-label">петля: {state}</div>
                <div className="lean">
                    <div className="figin">
                        <div className="breath">
                            <div className="floorshadow" aria-hidden="true" />
                            {/* Обычный <img>, а не next/image: слои накладываются
                                попиксельно, и любой независимый ресайз сдвинул бы
                                голову относительно тела. */}
                            <img className="fig photo body" alt="Тамара" src="/images/tamara/body.webp" />
                            <div className="headwrap" aria-hidden="true">
                                <span className="headpose">
                                    <img className="head" alt="" src="/images/tamara/head.webp" />
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {onAsk ? (
                <div className="ask">
                    <input
                        type="text"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && ask()}
                        placeholder={busy ? 'думает…' : 'спроси Тамару'}
                        disabled={busy}
                        aria-label="Вопрос Тамаре"
                    />
                    <button className="btn btn-sm" onClick={ask} disabled={busy || !draft.trim()}>
                        спросить
                    </button>
                </div>
            ) : null}
        </aside>
    );
}
