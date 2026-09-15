'use client';

import { useEffect, useState } from 'react';
import { isQaModeEnabled, setQaModeEnabled } from '@/components/qa/QaOverlay';

/** Тумблер режима тестировщика — запоминается в браузере, панель появляется на всех экранах. */
export default function QaModeSwitch() {
    const [on, setOn] = useState(false);

    useEffect(() => {
        setOn(isQaModeEnabled());
    }, []);

    const toggle = () => {
        const next = !on;
        setQaModeEnabled(next);
        setOn(next);
        // Оверлей читает флаг при загрузке — перерисуем страницу, чтобы панель появилась/исчезла сразу.
        window.location.reload();
    };

    return (
        <button
            type="button"
            onClick={toggle}
            className={`px-4 py-2 text-sm font-black uppercase tracking-widest ${on ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
        >
            {on ? 'Выключить режим' : 'Включить режим'}
        </button>
    );
}
