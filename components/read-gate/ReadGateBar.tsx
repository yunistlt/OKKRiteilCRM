'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DEFER_REASONS } from '@/lib/read-gate/constants';

/**
 * Панель шлюза для чужой страницы документа.
 *
 * Вёрстка документа — дело страницы, которая показывает разбор. Учёт времени,
 * маркер «дочитал» и разблокировка — дело шлюза, и они целиком здесь. Страница
 * импортирует компонент и ставит его внизу; больше от неё ничего не нужно.
 *
 * Внутри ровно та же механика, что на /read-gate: секунды копятся только при
 * открытой вкладке, уходят порциями раз в десять секунд, прирост сверяет
 * сервер, а доступ открывает только он.
 */
const BEAT_SECONDS = 10;

export default function ReadGateBar({ afterConfirm = '/' }: { afterConfirm?: string }) {
    const [gateId, setGateId] = useState<number | null>(null);
    const [required, setRequired] = useState(0);
    const [seconds, setSeconds] = useState(0);
    const [scrolled, setScrolled] = useState(false);
    const [ready, setReady] = useState(false);
    const [wasHidden, setWasHidden] = useState(false);
    const [deferUsed, setDeferUsed] = useState(false);
    const [deferOpen, setDeferOpen] = useState(false);
    const [deferMinutes, setDeferMinutes] = useState(60);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hidden, setHidden] = useState(false);

    const endMarker = useRef<HTMLDivElement | null>(null);
    const pending = useRef(0);
    const scrolledRef = useRef(false);

    // Кто мы и что читаем — спрашиваем сервер: страница об этом знать не обязана.
    useEffect(() => {
        let alive = true;
        fetch('/api/read-gate/state')
            .then((r) => r.json())
            .then((j) => {
                if (!alive) return;
                // Шлюз не нужен: документ уже подтверждён, роль не та, идёт звонок.
                if (!j.blocked) { setHidden(true); return; }
                setGateId(j.gate.id);
                setRequired(j.gate.requiredSeconds);
                setSeconds(j.gate.visibleSeconds);
                setScrolled(j.gate.scrolledToEnd);
                scrolledRef.current = j.gate.scrolledToEnd;
                setDeferUsed(!!j.gate.deferUsedToday);
                setDeferMinutes(j.deferMinutes ?? 60);
            })
            .catch(() => setHidden(true));
        return () => { alive = false; };
    }, []);

    useEffect(() => {
        const node = endMarker.current;
        if (!node || scrolledRef.current) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) {
                scrolledRef.current = true;
                setScrolled(true);
                observer.disconnect();
            }
        }, { threshold: 0.9 });
        observer.observe(node);
        return () => observer.disconnect();
    }, [hidden]);

    useEffect(() => {
        const tick = setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            pending.current += 1;
            setSeconds((s) => s + 1);
        }, 1000);
        const onVisibility = () => { if (document.visibilityState === 'hidden') setWasHidden(true); };
        document.addEventListener('visibilitychange', onVisibility);
        return () => { clearInterval(tick); document.removeEventListener('visibilitychange', onVisibility); };
    }, []);

    const beat = useCallback(async () => {
        if (gateId == null) return;
        const chunk = pending.current;
        pending.current = 0;
        try {
            const res = await fetch('/api/read-gate/beat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gateId, seconds: chunk, scrolledToEnd: scrolledRef.current }),
            });
            const json = await res.json();
            if (res.ok) {
                setSeconds(json.visibleSeconds);
                setScrolled(json.scrolledToEnd);
                setReady(!!json.ready);
            }
        } catch {
            pending.current += chunk;
        }
    }, [gateId]);

    useEffect(() => {
        const timer = setInterval(beat, BEAT_SECONDS * 1000);
        return () => clearInterval(timer);
    }, [beat]);

    useEffect(() => { if (scrolled) void beat(); }, [scrolled, beat]);

    if (hidden || gateId == null) {
        // Маркер оставляем всегда: без него страница, открытая до загрузки
        // состояния, не отметит прочтение.
        return <div ref={endMarker} aria-hidden style={{ height: 1 }} />;
    }

    const left = Math.max(0, required - seconds);
    const canConfirm = ready || (scrolled && left === 0);

    const confirm = async () => {
        setBusy(true);
        setError(null);
        await beat();
        try {
            const res = await fetch('/api/read-gate/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gateId }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Не удалось подтвердить');
            window.location.href = afterConfirm;
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
                body: JSON.stringify({ gateId, reason }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Не удалось отложить');
            window.location.href = afterConfirm;
        } catch (e: any) {
            setError(e.message);
            setBusy(false);
        }
    };

    return (
        <>
            <div ref={endMarker} className="mt-6 border-t pt-3 text-xs text-gray-400">Конец документа</div>
            <div className="sticky bottom-0 mt-4 border-t bg-white py-3">
                {wasHidden && <div className="mb-2 text-xs text-amber-700">Таймер стоял, пока вкладка была свёрнута.</div>}
                <div className="mb-2 text-sm text-gray-600">
                    {!scrolled && <div>Осталось пролистать документ до конца.</div>}
                    {left > 0 && <div>Кнопка станет активной через {left} сек.</div>}
                    {canConfirm && <div className="text-emerald-700">Можно приступать к работе.</div>}
                </div>
                {error && <div className="mb-2 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
                <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={confirm} disabled={!canConfirm || busy}>Прочитал, приступаю к работе</Button>
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
                            Работа откроется на {deferMinutes} минут, потом разбор вернётся. Руководитель увидит отсрочку и причину.
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
        </>
    );
}
