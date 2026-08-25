'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './shtab.css';
import { SHTAB_FONT_CLASS } from './fonts';
import Tamara, { useTamara } from './Tamara';
import { useShtab } from './useShtab';
import { VIEW_IDS, VIEW_TITLES } from './nav';
import type { ViewId, ViewProps } from './nav';
import Pult from './views/Pult';
import Minus from './views/Minus';
import Razbor from './views/Razbor';
import Karta from './views/Karta';
import Strat from './views/Strat';
import Arch from './views/Arch';
import Celi from './views/Celi';
import TamaraTab from './views/TamaraTab';

// «Штаб владельца» — рабочее место собственника по методологии «Альянс Стратег».
// Реестр минусов, разбор ситуации, карта ресурсов, стратегия. Слева стоит
// наставница Тамара и проверяет написанное по методичке.
//
// Раздел закрыт ролью admin (lib/rbac.ts): здесь лежат все проблемы компании,
// включая кадровые и финансовые.

const VIEWS: Record<ViewId, (props: ViewProps) => JSX.Element | null> = {
    pult: Pult,
    minus: Minus,
    razbor: Razbor,
    karta: Karta,
    strat: Strat,
    arch: Arch,
    celi: Celi,
    tamara: TamaraTab,
};

const SAVE_LABELS: Record<string, string> = {
    saving: 'сохраняю…',
    saved: 'сохранено',
    error: 'не сохранилось',
};

export default function ShtabPage() {
    const shtab = useShtab();
    const { say, reactive, node } = useTamara();
    const [view, setView] = useState<ViewId>('pult');
    const rootRef = useRef<HTMLDivElement>(null);
    const greeted = useRef(false);

    // Колонка Тамары считает свою высоту от области прокрутки, а не от окна:
    // над ней шапка приложения и, случается, баннер оповещений, поэтому 100vh
    // здесь врёт и фигуре срезает туфли.
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const scroller = root.closest('main') ?? document.documentElement;
        const apply = () => root.style.setProperty('--shtab-vh', `${scroller.clientHeight}px`);
        apply();
        const observer = new ResizeObserver(apply);
        observer.observe(scroller);
        return () => observer.disconnect();
    }, []);

    const { state, loadError, saveStatus } = shtab;

    useEffect(() => {
        if (greeted.current || !state) return;
        greeted.current = true;
        const open = state.minuses.filter((m) => !m.done).length;
        say(
            `В реестре ${open} открытых минусов. Приоритет пересчитывается сам — начинай с той области, где их больше всего.`,
            'Область с наибольшим числом минусов и есть приоритет: именно там сидит то, что порождает остальное.',
            'explain',
        );
    }, [state, say]);

    const go = useCallback((next: ViewId) => setView(next), []);

    const View = VIEWS[view];
    // Стабильная ссылка: виды держат её в зависимостях эффектов.
    const tamara = useMemo(() => ({ say, reactive }), [say, reactive]);

    return (
        <div className={`shtab ${SHTAB_FONT_CLASS}`} ref={rootRef}>
            <nav className="navstrip">
                <div className="navstrip-in">
                    {VIEW_IDS.map((id) => (
                        <button key={id} aria-current={id === view} onClick={() => go(id)}>
                            {VIEW_TITLES[id]}
                            {id === 'minus' && state ? (
                                <span className="badge">{state.minuses.filter((m) => !m.done).length}</span>
                            ) : null}
                            {id === 'arch' && state ? <span className="badge">{state.razbory.length}</span> : null}
                        </button>
                    ))}
                    {saveStatus !== 'idle' ? (
                        <span
                            className="badge"
                            style={{ marginLeft: 'auto', alignSelf: 'center', whiteSpace: 'nowrap' }}
                        >
                            {SAVE_LABELS[saveStatus]}
                        </span>
                    ) : null}
                </div>
            </nav>

            <div className="wrap">
                <div className="layout">
                    <Tamara view={node} />
                    <div className="main">
                        {loadError ? (
                            <div className="empty">
                                Не удалось загрузить Штаб: {loadError}
                                <br />
                                <br />
                                Проверь, применена ли миграция <code>20260825_shtab_owner_hq.sql</code>.
                            </div>
                        ) : !state ? (
                            <div className="empty">Загружаю…</div>
                        ) : (
                            <View shtab={shtab} tamara={tamara} go={go} />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
