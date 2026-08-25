'use client';

import { RAZBOR_STEPS, razborProgress, topArea } from '@/lib/shtab/types';
import { verdict } from '@/lib/shtab/xmr';
import Sparkline from '../Sparkline';
import { STATS } from '../stats';
import type { Stat } from '../stats';
import type { ViewProps } from '../nav';

function StatCard({ stat }: { stat: Stat }) {
    const v = verdict(stat.data);
    const last = stat.data[stat.data.length - 1];
    return (
        <div className="stat">
            <div className="stat-name">{stat.name}</div>
            <div className="stat-val">{last.toFixed(stat.dp)}</div>
            <div className="stat-unit">{stat.unit}</div>
            <div className="stat-foot">
                <span className={`verdict v-${v.kind}`}>{v.title}</span>
                <Sparkline data={stat.data} kind={v.kind} />
            </div>
            <div className="stat-src">{stat.src}</div>
        </div>
    );
}

export default function Pult({ shtab, go }: ViewProps) {
    const { state, active } = shtab;
    if (!state) return null;

    const top = topArea(state.areas, state.minuses);
    const openCount = state.minuses.filter((m) => !m.done).length;
    const step = Math.min(razborProgress(active) + 1, RAZBOR_STEPS);

    const week = STATS.filter((s) => s.period === 'week');
    const month = STATS.filter((s) => s.period === 'month');

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
                    <div className="statgrid">
                        {week.map((s) => (
                            <StatCard key={s.name} stat={s} />
                        ))}
                    </div>
                    <div className="block-label">
                        <span className="eyebrow">Статистики · месяц</span>
                    </div>
                    <div className="statgrid">
                        {month.map((s) => (
                            <StatCard key={s.name} stat={s} />
                        ))}
                    </div>
                </div>
            </div>
        </>
    );
}
