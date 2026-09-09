'use client';

import { useEffect, useState } from 'react';
import { RAZBOR_STEPS, razborProgress, topArea } from '@/lib/shtab/types';
import { verdict } from '@/lib/shtab/xmr';
import Sparkline from '../Sparkline';
import { STATS } from '../stats';
import type { Stat } from '../stats';
import type { ViewProps } from '../nav';

type StatsResponse = { series: Record<string, number[]>; errors: Record<string, string> };

function StatCard({ stat, live, failed }: { stat: Stat; live: number[] | null; failed: boolean }) {
    // Живой ряд — только из ответа маршрута. Демонстрационный ряд подставляется
    // исключительно метрикам без источника, чтобы карточка не была пустой.
    const data = stat.source === 'api' ? (live ?? []) : (stat.sample ?? []);
    const last = data.length > 0 ? data[data.length - 1] : null;
    const v = verdict(data);

    return (
        <div className="stat">
            <div className="stat-name">{stat.name}</div>
            <div className="stat-val">{last === null ? '—' : last.toFixed(stat.dp)}</div>
            <div className="stat-unit">{stat.unit}</div>
            <div className="stat-foot">
                <span className={`verdict v-${failed ? 'thin' : v.kind}`}>
                    {failed ? 'источник не отвечает' : v.title}
                </span>
                {data.length > 1 && !failed ? <Sparkline data={data} kind={v.kind} /> : null}
            </div>
            <div className="stat-src">{stat.src}</div>
        </div>
    );
}

export default function Pult({ shtab, go }: ViewProps) {
    const { state, active } = shtab;
    const [stats, setStats] = useState<StatsResponse | null>(null);
    const [statsFailed, setStatsFailed] = useState(false);

    useEffect(() => {
        let alive = true;
        fetch('/api/shtab/stats')
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((data: StatsResponse) => alive && setStats(data))
            .catch(() => alive && setStatsFailed(true));
        return () => {
            alive = false;
        };
    }, []);

    if (!state) return null;

    const top = topArea(state.areas, state.minuses);
    const openCount = state.minuses.filter((m) => !m.done).length;
    const step = Math.min(razborProgress(active) + 1, RAZBOR_STEPS);

    const card = (s: Stat) => (
        <StatCard
            key={s.key}
            stat={s}
            live={stats?.series[s.key] ?? null}
            failed={s.source === 'api' && (statsFailed || Boolean(stats?.errors[s.key]))}
        />
    );

    return (
        <>
            <div className="view-head">
                <div className="eyebrow">Понедельник, 09:00</div>
                <h1>Пульт</h1>
                <p>Что происходит в компании прямо сейчас и что ты с этим делаешь. Работа идёт на соседних экранах.</p>
            </div>

            <div className="stack">
                <div className="card" style={{ borderTop: '3px solid var(--signal)', paddingTop: 17 }}>
                    <div className="eyebrow">Приоритетная область · пересчитывается сама</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', margin: '8px 0 4px' }}>
                        <h2 style={{ fontSize: 29 }}>{top.area?.title ?? '—'}</h2>
                        <span className="num" style={{ fontSize: 18, color: 'var(--signal)' }}>
                            {top.count} минусов
                        </span>
                        <span className="eyebrow">из {openCount} открытых по компании</span>
                    </div>
                    <p style={{ fontSize: 13.5, color: 'var(--ink-2)', maxWidth: '64ch' }}>
                        Заведи новый минус или закрой старый — приоритет пересчитается. Мнения в расчёте не участвуют.
                    </p>
                    <div className="row" style={{ marginTop: 14 }}>
                        <button className="btn" onClick={() => go('minus')}>
                            Открыть реестр минусов
                        </button>
                        <button className="btn btn-primary" onClick={() => go('razbor')}>
                            Продолжить разбор · шаг {step} из {RAZBOR_STEPS}
                        </button>
                    </div>
                </div>

                <div>
                    <div className="block-label">
                        <span className="eyebrow">Статистики · неделя</span>
                    </div>
                    <div className="statgrid">{STATS.filter((s) => s.period === 'week').map(card)}</div>
                    <div className="block-label">
                        <span className="eyebrow">Статистики · месяц</span>
                    </div>
                    <div className="statgrid">{STATS.filter((s) => s.period === 'month').map(card)}</div>
                    <p className="hint" style={{ marginTop: 10 }}>
                        Подключён один источник — приход группы по выпискам Точки и Т‑Банка. Остальные строки ждут
                        коннекторов; у каждой подписано, откуда придут числа.
                    </p>
                </div>
            </div>
        </>
    );
}
