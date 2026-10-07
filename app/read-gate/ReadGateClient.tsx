'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import HelpArticle from '@/components/help/HelpArticle';
import { Button } from '@/components/ui/button';
import { DEFER_REASONS } from '@/lib/read-gate/constants';

/**
 * Документ перед началом работы: таймер, маркер «дочитал», подтверждение.
 *
 * Счётчик на странице — только для человека. Решение о доступе принимает
 * сервер по своим данным, поэтому дорисовать кнопку из консоли бесполезно.
 */
type Props = {
    gateId: number;
    requiredSeconds: number;
    visibleSeconds: number;
    scrolledToEnd: boolean;
    deferUsedToday: boolean;
    deferMinutes: number;
    title: string;
    dateLabel: string | null;
    body: string;
};

/** Раз в сколько секунд страница отчитывается о прочитанном времени. */
const BEAT_SECONDS = 10;

export default function ReadGateClient(props: Props) {
    const [seconds, setSeconds] = useState(props.visibleSeconds);
    const [scrolled, setScrolled] = useState(props.scrolledToEnd);
    const [ready, setReady] = useState(false);
    const [wasHidden, setWasHidden] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [deferOpen, setDeferOpen] = useState(false);
    const [deferUsed, setDeferUsed] = useState(props.deferUsedToday);

    const endMarker = useRef<HTMLDivElement | null>(null);
    // Секунды, не отправленные на сервер.
    const pending = useRef(0);
    const scrolledRef = useRef(props.scrolledToEnd);

    /**
     * Маркер конца документа. Засчитываем только когда он ПОКАЗАН во вьюпорте:
     * программная прокрутка в конец страницы маркер не «показывает».
     */
    useEffect(() => {
        const node = endMarker.current;
        if (!node || scrolledRef.current) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    scrolledRef.current = true;
                    setScrolled(true);
                    observer.disconnect();
                }
            },
            { threshold: 0.9 },
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    /**
     * Таймер идёт, только пока вкладка открыта. Свернул — время стоит, и при
     * возврате человеку об этом говорим: незаметная пауза выглядит поломкой.
     */
    useEffect(() => {
        const tick = setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            pending.current += 1;
            setSeconds((s) => s + 1);
        }, 1000);

        const onVisibility = () => {
            if (document.visibilityState === 'hidden') setWasHidden(true);
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            clearInterval(tick);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, []);

    // Отчёт серверу порциями: одним числом в конце время не принимается.
    const beat = useCallback(async () => {
        const chunk = pending.current;
        if (!chunk && scrolledRef.current === props.scrolledToEnd) return;
        pending.current = 0;
        try {
            const res = await fetch('/api/read-gate/beat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gateId: props.gateId, seconds: chunk, scrolledToEnd: scrolledRef.current }),
            });
            const json = await res.json();
            if (res.ok) {
                setSeconds(json.visibleSeconds);
                setScrolled(json.scrolledToEnd);
                setReady(!!json.ready);
            }
        } catch {
            // Сеть моргнула — секунды вернём в следующую порцию.
            pending.current += chunk;
        }
    }, [props.gateId, props.scrolledToEnd]);

    useEffect(() => {
        const timer = setInterval(beat, BEAT_SECONDS * 1000);
        return () => clearInterval(timer);
    }, [beat]);

    // Долистал раньше, чем подошла порция — сообщаем сразу, иначе кнопка
    // оживает с задержкой до десяти секунд и выглядит сломанной.
    useEffect(() => {
        if (scrolled) void beat();
    }, [scrolled, beat]);

    const left = Math.max(0, props.requiredSeconds - seconds);
    const canConfirm = ready || (scrolled && left === 0);

    const confirm = async () => {
        setBusy(true);
        setError(null);
        await beat();
        try {
            const res = await fetch('/api/read-gate/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gateId: props.gateId }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Не удалось подтвердить');
            window.location.href = '/';
        } catch (e: any) {
            setError(e.message);
            setBusy(false);
        }
    };

    const sendDefer = async (reason: string) => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch('/api/read-gate/defer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gateId: props.gateId, reason }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Не удалось отложить');
            setDeferUsed(true);
            window.location.href = '/';
        } catch (e: any) {
            setError(e.message);
            setBusy(false);
        }
    };

    return (
        <div className="mx-auto max-w-3xl p-4">
            <div className="mb-3 border-l-[3px] border-l-blue-600 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                Прочитайте разбор — после этого откроется работа и придёт план дня.
            </div>

            <h1 className="text-2xl font-black text-gray-900">{props.title}</h1>
            {props.dateLabel && <div className="mt-1 text-sm text-gray-500">за {props.dateLabel}</div>}

            <div className="mt-4">
                <HelpArticle content={props.body} />
            </div>

            {/* Маркер конца: пока он не показан на экране, документ не дочитан. */}
            <div ref={endMarker} className="mt-6 border-t pt-3 text-xs text-gray-400">
                Конец документа
            </div>

            <div className="sticky bottom-0 mt-4 border-t bg-white py-3">
                {wasHidden && (
                    <div className="mb-2 text-xs text-amber-700">
                        Таймер стоял, пока вкладка была свёрнута.
                    </div>
                )}
                <div className="mb-2 text-sm text-gray-600">
                    {!scrolled && <div>Осталось пролистать документ до конца.</div>}
                    {left > 0 && <div>Кнопка станет активной через {left} сек.</div>}
                    {canConfirm && <div className="text-emerald-700">Можно приступать к работе.</div>}
                </div>
                {error && <div className="mb-2 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

                <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={confirm} disabled={!canConfirm || busy}>
                        Прочитал, приступаю к работе
                    </Button>
                    {!deferUsed && !deferOpen && (
                        <Button variant="outline" onClick={() => setDeferOpen(true)} disabled={busy}>
                            Срочное дело, прочитаю позже
                        </Button>
                    )}
                    {deferUsed && <span className="text-xs text-gray-500">Отсрочка на сегодня использована.</span>}
                </div>

                {deferOpen && !deferUsed && (
                    <div className="mt-2 border p-3">
                        <div className="mb-2 text-sm text-gray-700">
                            Работа откроется на {props.deferMinutes} минут, потом разбор вернётся.
                            Руководитель увидит отсрочку и причину.
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {DEFER_REASONS.map((reason) => (
                                <Button key={reason} size="sm" variant="outline" disabled={busy} onClick={() => sendDefer(reason)}>
                                    {reason}
                                </Button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
