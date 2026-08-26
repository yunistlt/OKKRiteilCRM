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
import Projects from './views/Projects';
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
    projects: Projects,
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
    const [asking, setAsking] = useState(false);
    const briefed = useRef(false);

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

    // Понедельничная сводка: Тамара начинает разговор сама. Собирается заданием
    // по расписанию и хранится, поэтому открытие раздела не стоит вызова модели.
    useEffect(() => {
        // Один раз за открытие раздела. Без этого сводка произносилась бы заново
        // при каждом обновлении состояния — то есть после каждого заведённого
        // минуса, перебивая то, что Тамара только что сказала по делу.
        if (!state || briefed.current) return;
        briefed.current = true;
        let alive = true;
        fetch('/api/shtab/tamara')
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (!alive || !data?.briefing?.text) return;
                say(data.briefing.text, `Сводка за неделю с ${data.briefing.week_start}.`, 'explain');
            })
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, [state, say]);

    const ask = useCallback(
        async (question: string) => {
            setAsking(true);
            say(question, undefined, 'listening');
            try {
                const res = await fetch('/api/shtab/tamara', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data?.error || `Ответ ${res.status}`);
                say(
                    data.reply || 'Пусто.',
                    data.used_tools?.length ? `Смотрела: ${data.used_tools.join(', ')}.` : 'Инструменты не понадобились.',
                    'explain',
                );
            } catch (e) {
                say(`Не смогла ответить: ${(e as Error).message}`, undefined, 'object');
            } finally {
                setAsking(false);
            }
        },
        [say],
    );

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
                            {id === 'projects' && shtab.active?.projects.length ? (
                                <span className="badge">{shtab.active.projects.length}</span>
                            ) : null}
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
                    <Tamara view={node} onAsk={ask} busy={asking} />
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
