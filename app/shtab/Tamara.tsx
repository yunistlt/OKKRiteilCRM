'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Наставница слева: стоит постоянно, реагирует телом на то, что владелец пишет,
// и говорит текстом. Липсинка нет и не планируется на этом этапе — общение
// текстовое, поэтому нужны только петли языка тела.
//
// Фигура собрана двумя слоями (тело и голова) из одного снимка. Слои двигаются
// раздельно, потому что голова — то, что глаз считывает как «живая». Нарезка
// делается scripts/shtab-cut-tamara-layers.py; там же лежит объяснение, почему
// растушёвка на шее односторонняя.

export type TamaraState =
    | 'idle'
    | 'listening'
    | 'thinking'
    | 'object'
    | 'explain'
    | 'approve'
    | 'alert'
    | 'away'
    // Только у живой Тамары (ролики): поздоровалась, приняла комплимент,
    // покрутилась, показывая наряд.
    | 'greet'
    | 'pleased'
    | 'twirl';

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

type Outfit = { slug: string; title: string; imageUrl: string; reason: string };

type LiveClip = { webmUrl: string; hevcUrl: string | null; posterUrl: string; durationMs: number };
type LiveSet = { outfitSlug: string; outfitTitle: string; clips: Record<string, LiveClip> };

/**
 * Образ дня и ролики живой Тамары.
 *
 * Пока образ не приехал — и если гардероб пуст или смена одежды выключена —
 * показывается прежняя двухслойная фигура. Пустой силуэт на первом экране
 * Штаба хуже, чем вчерашняя одежда.
 */
function useOutfit(): { outfit: Outfit | null; live: LiveSet | null } {
    const [outfit, setOutfit] = useState<Outfit | null>(null);
    const [live, setLive] = useState<LiveSet | null>(null);

    useEffect(() => {
        let alive = true;
        fetch('/api/shtab/tamara/outfit')
            .then((r) => r.json())
            .then((j) => {
                if (!alive || !j?.ok) return;
                if (j.outfit) setOutfit(j.outfit as Outfit);
                if (j.live) setLive(j.live as LiveSet);
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, []);

    return { outfit, live };
}

/**
 * Safari не показывает прозрачность у WebM — для него отдельный файл HEVC с
 * альфой. Остальные браузеры HEVC с альфой не понимают: Chrome на маке его
 * проиграет, но на чёрном фоне. Поэтому выбор по браузеру, а не по canPlayType.
 */
function isSafari(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    return /safari/i.test(ua) && !/chrome|chromium|crios|fxios|android|edg/i.test(ua);
}

function clipSrc(clip: LiveClip, safari: boolean): string | null {
    return safari ? clip.hevcUrl : clip.webmUrl;
}

/**
 * Живая Тамара: ролики во весь рост вместо картинки.
 *
 * Покой крутится по кругу. На смену состояния, у которого есть свой ролик,
 * включается он — один раз, — и по окончании она возвращается в покой. Все
 * ролики начинаются и кончаются в одной и той же позе, поэтому стык не виден.
 *
 * Ролики держатся на странице все сразу и переключаются видимостью: подмена
 * src у одного видео даёт мигание пустым кадром, пока грузится новый файл.
 */
function LiveFigure({ live, state }: { live: LiveSet; state: TamaraState }) {
    const safari = useMemo(isSafari, []);
    const names = useMemo(
        () => Object.keys(live.clips).filter((name) => clipSrc(live.clips[name], safari)),
        [live, safari],
    );
    const refs = useRef<Record<string, HTMLVideoElement | null>>({});
    const [playing, setPlaying] = useState('idle');
    const playingRef = useRef('idle');
    playingRef.current = playing;

    // Покой запускается так, чтобы отказ браузера не оставлял её замершей.
    // Safari вправе не дать видео стартовать без действия человека (режим
    // энергосбережения, запрет автовоспроизведения для сайта) — раньше отказ
    // молча проглатывался, и до перезагрузки на экране стоял первый кадр.
    // Теперь запуск повторяется на первом клике или клавише, пока она в покое.
    const startIdle = useCallback(() => {
        const idle = refs.current.idle;
        if (!idle) return;
        idle.play().catch(() => {
            const retry = () => {
                document.removeEventListener('pointerdown', retry);
                document.removeEventListener('keydown', retry);
                if (playingRef.current === 'idle') void idle.play().catch(() => undefined);
            };
            document.addEventListener('pointerdown', retry);
            document.addEventListener('keydown', retry);
        });
    }, []);

    const backToIdle = useCallback(() => {
        const idle = refs.current.idle;
        if (idle) idle.currentTime = 0;
        setPlaying('idle');
        startIdle();
    }, [startIdle]);

    // Состояние без своего ролика — покой: он честнее, чем застывший кадр.
    useEffect(() => {
        // Кружение есть не у каждого образа: без него на слова про наряд она
        // хотя бы улыбается, как на комплимент.
        const wanted = state === 'twirl' && !names.includes('twirl') ? 'pleased' : state;
        const next = wanted !== 'idle' && names.includes(wanted) ? wanted : null;
        if (!next) return;
        const video = refs.current[next];
        if (!video) return;
        video.currentTime = 0;
        // Ролик реакции не стартовал — возвращаемся в покой. Иначе покой уже
        // остановлен, а реакция так и не пошла: она замирает на первом кадре
        // и onEnded, который вернул бы её в покой, не наступит никогда.
        video.play().catch(backToIdle);
        setPlaying(next);
    }, [state, names, backToIdle]);

    useEffect(() => {
        for (const name of names) {
            const video = refs.current[name];
            if (!video) continue;
            if (name === playing) {
                if (name === 'idle') startIdle();
            } else {
                video.pause();
            }
        }
    }, [playing, names, startIdle]);

    if (!names.includes('idle')) return null;

    return (
        <span className="live" title={live.outfitTitle || undefined}>
            {names.map((name) => {
                const clip = live.clips[name];
                return (
                    <video
                        key={name}
                        ref={(el) => {
                            refs.current[name] = el;
                        }}
                        className={`fig photo live-clip${name === 'idle' ? ' base' : ''}${name === playing ? ' on' : ''}`}
                        src={clipSrc(clip, safari) ?? undefined}
                        poster={name === 'idle' ? clip.posterUrl : undefined}
                        muted
                        playsInline
                        preload="auto"
                        autoPlay={name === 'idle'}
                        loop={name === 'idle'}
                        onEnded={name === 'idle' ? undefined : backToIdle}
                        aria-hidden={name !== playing}
                    />
                );
            })}
        </span>
    );
}

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
    quiet,
}: {
    view: TamaraView;
    /** Вопрос владельца. Без обработчика поле ввода не показывается. */
    onAsk?: (question: string) => void;
    busy?: boolean;
    /**
     * Тихий режим: только фигура, без реплики.
     *
     * Нужен на вкладке «Разговор», где переписка идёт лентой справа: пузырь с
     * последним ответом показывал бы то же самое во второй раз.
     */
    quiet?: boolean;
}) {
    const { state, message, log, typing } = view;
    const [draft, setDraft] = useState('');
    const { outfit, live } = useOutfit();
    // В Safari без HEVC-файла живой Тамары нет — тогда стоит картинка образа.
    const liveReady = !!live?.clips.idle && !!clipSrc(live.clips.idle, isSafari());

    const ask = () => {
        const text = draft.trim();
        if (!text || busy || !onAsk) return;
        onAsk(text);
        setDraft('');
    };

    return (
        <aside className={`tam${quiet ? ' tam-quiet' : ''}${liveReady ? ' tam-live' : ''}`} data-state={state}>
            {quiet ? null : (
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
            )}

            <div className="stage">
                <div className="loop-label">петля: {state}</div>
                <div className="lean">
                    <div className="figin">
                        <div className="breath">
                            <div className="floorshadow" aria-hidden="true" />
                            {/* Обычный <img>, а не next/image: слои накладываются
                                попиксельно, и любой независимый ресайз сдвинул бы
                                голову относительно тела. */}
                            {live && liveReady ? (
                                <LiveFigure live={live} state={state} />
                            ) : outfit ? (
                                /* Образ дня приходит цельным кадром — голова на нём
                                   уже своя, второй слой её бы задвоил. */
                                <img
                                    className="fig photo body outfit"
                                    alt={`Тамара, ${outfit.title}`}
                                    title={`${outfit.title} — ${outfit.reason}`}
                                    src={outfit.imageUrl}
                                />
                            ) : (
                                <>
                                    <img className="fig photo body" alt="Тамара" src="/images/tamara/body.webp" />
                                    <div className="headwrap" aria-hidden="true">
                                        <span className="headpose">
                                            <img className="head" alt="" src="/images/tamara/head.webp" />
                                        </span>
                                    </div>
                                </>
                            )}
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
