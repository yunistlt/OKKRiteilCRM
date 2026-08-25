'use client';

import { useEffect, useMemo, useState } from 'react';
import { checkProject } from '@/lib/shtab/checks';
import { projectDraftsFromResources } from '@/lib/shtab/strategy';
import type { ShtabProject } from '@/lib/shtab/types';
import type { ViewProps } from '../nav';

const STATUS_TITLES: Record<ShtabProject['status'], string> = {
    open: 'в работе',
    done: 'сделан',
    dropped: 'отменён',
};

export default function Projects({ shtab, tamara, go }: ViewProps) {
    const { active, addProject, patchProject, removeProject } = shtab;
    const [title, setTitle] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const projects = useMemo(() => active?.projects ?? [], [active]);

    // Худший из проектов задаёт реплику: пока есть проект без имени и даты,
    // говорить про остальные незачем.
    const worst = useMemo(() => {
        let result: ReturnType<typeof checkProject> = null;
        for (const p of projects) {
            const v = checkProject(p.owner_name, p.due_on);
            if (v?.kind === 'bad') return v;
            if (v && !result) result = v;
        }
        return result;
    }, [projects]);

    useEffect(() => {
        tamara.reactive('project', worst);
    }, [tamara, worst]);

    if (!active) return null;

    if (!active.strategy.trim()) {
        return (
            <>
                <div className="view-head">
                    <div className="eyebrow">Стратегия превращается в дела</div>
                    <h1>Проекты</h1>
                </div>
                <div className="empty">
                    Сначала напиши стратегию — проекты выходят из неё.
                    <br />
                    <br />
                    <button className="btn btn-primary" onClick={() => go('strat')}>
                        К стратегии
                    </button>
                </div>
            </>
        );
    }

    const add = async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || busy) return;
        setBusy(true);
        setError(null);
        try {
            await addProject(trimmed);
            setTitle('');
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const explode = async () => {
        const drafts = projectDraftsFromResources(active.resources);
        if (drafts.length === 0) return;
        setBusy(true);
        setError(null);
        try {
            for (const draft of drafts) await addProject(draft);
            tamara.say(
                'Разложил карту ресурсов на проекты. Теперь у каждого поставь ответственного и дату — без них это список намерений.',
                'Проект — это дело, у которого есть кому и к какому числу. Срок ставится проекту, а не цели.',
                'explain',
            );
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <div className="view-head">
                <div className="eyebrow">Стратегия превращается в дела</div>
                <h1>Проекты</h1>
                <p>
                    То, что останется после разбора, когда стратегия перестанет быть текстом. У каждого проекта один
                    ответственный и дата — иначе он проигрывает текучке.
                </p>
            </div>

            <div className="card" style={{ marginBottom: 18 }}>
                <div className="eyebrow" style={{ marginBottom: 11 }}>
                    Завести проект
                </div>
                <div className="row">
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void add(title)}
                        placeholder="Например: закупить и смонтировать вторую камеру полимеризации"
                        style={{ flex: 1, minWidth: 260 }}
                    />
                    <button className="btn btn-primary" onClick={() => void add(title)} disabled={busy || !title.trim()}>
                        Добавить
                    </button>
                    {active.resources.length > 0 ? (
                        <button className="btn" onClick={() => void explode()} disabled={busy}>
                            Разложить карту ресурсов на проекты
                        </button>
                    ) : null}
                </div>
                {error ? <div className="mark m-bad">{error}</div> : null}
            </div>

            {projects.length === 0 ? (
                <div className="empty">
                    Проектов нет. Стратегия без проектов остаётся текстом: её некому исполнять и не в какой срок.
                </div>
            ) : (
                <div className="arch">
                    {projects.map((p) => {
                        const v = checkProject(p.owner_name, p.due_on);
                        return (
                            <div key={p.id} className={`arch-row${p.status === 'done' ? ' done' : ''}`}>
                                <div className="arch-t">
                                    <input
                                        type="text"
                                        value={p.title}
                                        onChange={(e) => patchProject(p.id, { title: e.target.value })}
                                        style={{ fontWeight: 600 }}
                                    />
                                    <div className="row" style={{ marginTop: 8 }}>
                                        <input
                                            type="text"
                                            value={p.owner_name}
                                            onChange={(e) => patchProject(p.id, { owner_name: e.target.value })}
                                            placeholder="ответственный"
                                            style={{ width: 'auto', minWidth: 160, flex: '0 1 200px' }}
                                        />
                                        <input
                                            type="date"
                                            value={p.due_on ?? ''}
                                            onChange={(e) => patchProject(p.id, { due_on: e.target.value || null })}
                                            style={{ width: 'auto', minWidth: 150, flex: '0 1 170px' }}
                                        />
                                        {v ? <span className={`mark m-${v.kind}`}>{v.short}</span> : null}
                                    </div>
                                </div>
                                <div className="row">
                                    <select
                                        value={p.status}
                                        onChange={(e) =>
                                            patchProject(p.id, { status: e.target.value as ShtabProject['status'] })
                                        }
                                        style={{ width: 'auto', minWidth: 120 }}
                                    >
                                        {(Object.keys(STATUS_TITLES) as ShtabProject['status'][]).map((s) => (
                                            <option key={s} value={s}>
                                                {STATUS_TITLES[s]}
                                            </option>
                                        ))}
                                    </select>
                                    <button className="btn btn-sm btn-danger" onClick={() => void removeProject(p.id)}>
                                        убрать
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </>
    );
}
