'use client';

import { topArea } from '@/lib/shtab/types';
import type { ViewProps } from '../nav';

export default function Arch({ shtab, go }: ViewProps) {
    const { state, active, openRazbor, newRazbor } = shtab;
    if (!state) return null;

    const top = topArea(state.areas, state.minuses);
    const titleByCode = new Map(state.areas.map((a) => [a.code, a.title]));

    return (
        <>
            <div className="view-head">
                <div className="eyebrow">История по всем областям</div>
                <h1>Разборы</h1>
                <p>
                    Каждый разбор остаётся: какая была ситуация, какое «почему», какая стратегия из этого вышла. Через
                    год отсюда видно, какие причины ты угадывал, а какие нет.
                </p>
            </div>

            <div className="arch">
                {state.razbory.length === 0 ? (
                    <div className="empty">Разборов ещё нет.</div>
                ) : (
                    state.razbory.map((r) => {
                        const isActive = r.id === active?.id;
                        const [cls, label] =
                            r.status === 'done'
                                ? ['st-done', 'закрыт']
                                : isActive
                                  ? ['st-work', 'в работе']
                                  : ['st-draft', 'черновик'];
                        return (
                            <div key={r.id} className={`arch-row ${isActive ? 'active' : ''}`}>
                                <div className="arch-meta">
                                    {new Date(r.created_at).toLocaleDateString('ru-RU', {
                                        day: '2-digit',
                                        month: 'short',
                                    })}
                                    <br />
                                    {titleByCode.get(r.area_code) ?? r.area_code}
                                </div>
                                <div className="arch-t">
                                    <b>{r.situation || 'ситуация не сформулирована'}</b>
                                    <small>{r.why || 'причина не найдена'}</small>
                                </div>
                                <div className="row">
                                    <span className={`status ${cls}`}>{label}</span>
                                    {isActive ? null : (
                                        <button
                                            className="btn btn-sm"
                                            onClick={async () => {
                                                await openRazbor(r.id);
                                                go('razbor');
                                            }}
                                        >
                                            открыть
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <div className="row" style={{ marginTop: 16 }}>
                <button
                    className="btn btn-primary"
                    onClick={async () => {
                        await newRazbor(top.area?.code ?? state.areas[0].code);
                        go('razbor');
                    }}
                >
                    Начать разбор приоритетной области
                </button>
            </div>
        </>
    );
}
