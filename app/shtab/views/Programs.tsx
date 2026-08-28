'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { checkProgram } from '@/lib/shtab/program-checks';
import type { ProgramProblem } from '@/lib/shtab/program-checks';
import type { BlockDraft, ProgramDraft, ProgramTask, TaskKind } from '@/lib/shtab/programs';
import type { ViewProps } from '../nav';

type Kind = { code: TaskKind; title: string; hint: string; ordinal: number };
type Block = { id: number; ordinal: number; title: string; excerpt: string; rationale: string };
type Program = { id: number; block_id: number; main_task: string; manager_name: string; status: string; source: string };
type Task = {
    id: number;
    program_id: number;
    kind: TaskKind;
    ordinal: number;
    text: string;
    why: string;
    metric: string;
    target_value: string;
    source_note: string;
    fact_value: string;
    done: boolean;
};

export default function Programs({ shtab, go }: ViewProps) {
    const { active } = shtab;
    const razborId = active?.id ?? null;

    const [kinds, setKinds] = useState<Kind[]>([]);
    const [blocks, setBlocks] = useState<Block[]>([]);
    const [programs, setPrograms] = useState<Program[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [draftBlocks, setDraftBlocks] = useState<BlockDraft[] | null>(null);
    const [draftProgram, setDraftProgram] = useState<{ blockId: number; program: ProgramDraft; problems: ProgramProblem[] } | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [google, setGoogle] = useState<{
        configured: boolean;
        connected: boolean;
        account: string | null;
    } | null>(null);

    const load = useCallback(async () => {
        if (!razborId) return;
        const res = await fetch(`/api/shtab/block?razbor_id=${razborId}`);
        const data = await res.json();
        if (!res.ok) {
            setError(data?.error ?? 'Не удалось загрузить блоки');
            return;
        }
        setKinds(data.kinds ?? []);
        setBlocks(data.blocks ?? []);
        setPrograms(data.programs ?? []);
        setTasks(data.tasks ?? []);
    }, [razborId]);

    useEffect(() => {
        void load();
    }, [load]);

    // Ритм планёрок живёт рядом с программами: на недельной разбираются именно их
    // производственные задачи, поэтому подключение календаря стоит здесь.
    useEffect(() => {
        fetch('/api/shtab/google')
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => d && setGoogle(d))
            .catch(() => {});
    }, []);

    const call = async (what: string, url: string, body: unknown) => {
        setBusy(what);
        setError(null);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? `Ответ ${res.status}`);
            return data;
        } catch (e) {
            setError((e as Error).message);
            return null;
        } finally {
            setBusy(null);
        }
    };

    const askBlocks = async () => {
        const data = await call('blocks', '/api/shtab/tamara/blocks', { razbor_id: razborId });
        if (data) setDraftBlocks(data.blocks ?? []);
    };

    const saveBlocks = async () => {
        if (!draftBlocks) return;
        const data = await call('save-blocks', '/api/shtab/block', { razbor_id: razborId, blocks: draftBlocks });
        if (data) {
            setDraftBlocks(null);
            await load();
        }
    };

    const askProgram = async (blockId: number) => {
        const data = await call(`program-${blockId}`, '/api/shtab/tamara/program', { block_id: blockId });
        if (data) setDraftProgram({ blockId, program: data.program, problems: data.problems ?? [] });
    };

    const saveProgram = async () => {
        if (!draftProgram) return;
        const data = await call('save-program', '/api/shtab/program', {
            block_id: draftProgram.blockId,
            mainTask: draftProgram.program.mainTask,
            managerName: draftProgram.program.managerName,
            source: 'tamara',
            tasks: draftProgram.program.tasks,
        });
        if (data) {
            setDraftProgram(null);
            await load();
        }
    };

    const kindsSorted = useMemo(() => [...kinds].sort((a, b) => a.ordinal - b.ordinal), [kinds]);

    if (!active) return null;

    if (!active.strategy.trim()) {
        return (
            <>
                <div className="view-head">
                    <div className="eyebrow">Между стратегией и проектами</div>
                    <h1>Программы</h1>
                </div>
                <div className="empty">
                    Блоки режутся из текста стратегии — сначала напиши её.
                    <br />
                    <br />
                    <button className="btn btn-primary" onClick={() => go('strat')}>
                        К стратегии
                    </button>
                </div>
            </>
        );
    }

    return (
        <>
            <div className="view-head">
                <div className="eyebrow">Стратегия → блоки → программы</div>
                <h1>Программы</h1>
                <p className="lede">
                    Стратегия режется на логические блоки, под каждый пишется программа. У программы обязательны
                    главная задача, один руководитель и производственные задачи — числа, к которым она приводит.
                    Без чисел её выполнят по шагам и отчитаются, а положение не изменится.
                </p>
            </div>

            {error ? <div className="warn">{error}</div> : null}

            {google ? (
                <section className="card rhythm">
                    <h2>Ритм планёрок</h2>
                    {!google.configured ? (
                        <p className="muted">
                            Календарь не настроен. Нужны GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
                            и SHTAB_TOKEN_KEY в переменных окружения — как их получить, написано в docs/shtab/TAMARA.md.
                        </p>
                    ) : google.connected ? (
                        <>
                            <p className="muted">
                                Подключён {google.account ? <b>{google.account}</b> : 'аккаунт Google'}. Ежедневная,
                                недельная, месячная и квартальная встречи стоят в отдельном календаре «Ритм Штаба».
                                Повестка обновляется по понедельникам, время встреч не двигается — двигаешь только ты.
                            </p>
                            <button
                                className="btn btn-sm"
                                onClick={async () => {
                                    await call('revoke', '/api/shtab/google/revoke', {});
                                    setGoogle((g) => (g ? { ...g, connected: false, account: null } : g));
                                }}
                                disabled={busy === 'revoke'}
                            >
                                Отключить календарь
                            </button>
                        </>
                    ) : (
                        <>
                            <p className="muted">
                                Планёрки можно поставить в календарь: ежедневная 15 минут, недельная час по числам
                                программ, месячная полдня, квартальная день. Штаб заведёт отдельный календарь и будет
                                писать только в него — личные события останутся недоступны.
                            </p>
                            <a className="btn btn-primary btn-sm" href="/api/shtab/google/start">
                                Подключить Google Calendar
                            </a>
                        </>
                    )}
                </section>
            ) : null}

            {blocks.length === 0 && !draftBlocks ? (
                <div className="empty">
                    Стратегия ещё не разрезана на блоки.
                    <br />
                    <br />
                    <button className="btn btn-primary" onClick={askBlocks} disabled={busy === 'blocks'}>
                        {busy === 'blocks' ? 'Тамара читает стратегию…' : 'Попросить Тамару предложить нарезку'}
                    </button>
                </div>
            ) : null}

            {draftBlocks ? (
                <section className="card draft">
                    <h2>Тамара предлагает нарезку</h2>
                    <p className="muted">Решаешь ты. Сохранится только то, что подтвердишь.</p>
                    {draftBlocks.map((b, i) => (
                        <div key={`${b.ordinal}-${i}`} className="block-draft">
                            <input
                                className="block-title"
                                value={b.title}
                                onChange={(e) =>
                                    setDraftBlocks((prev) =>
                                        prev ? prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) : prev,
                                    )
                                }
                                aria-label={`Название блока ${i + 1}`}
                            />
                            <div className="excerpt">{b.excerpt}</div>
                            <div className="why">Почему так: {b.rationale}</div>
                            <button
                                className="btn btn-sm"
                                onClick={() => setDraftBlocks((prev) => (prev ? prev.filter((_, j) => j !== i) : prev))}
                            >
                                убрать блок
                            </button>
                        </div>
                    ))}
                    <div className="row">
                        <button className="btn btn-primary" onClick={saveBlocks} disabled={busy === 'save-blocks'}>
                            Утвердить нарезку
                        </button>
                        <button className="btn" onClick={() => setDraftBlocks(null)}>
                            Отказаться
                        </button>
                    </div>
                </section>
            ) : null}

            {blocks.map((block) => {
                const program = programs.find((p) => p.block_id === block.id) ?? null;
                const own = program ? tasks.filter((t) => t.program_id === program.id) : [];
                const problems = program
                    ? checkProgram({
                          mainTask: program.main_task,
                          managerName: program.manager_name,
                          tasks: own.map(
                              (t): ProgramTask => ({
                                  kind: t.kind,
                                  ordinal: t.ordinal,
                                  text: t.text,
                                  why: t.why,
                                  metric: t.metric,
                                  targetValue: t.target_value,
                                  sourceNote: t.source_note,
                              }),
                          ),
                      })
                    : [];

                return (
                    <section className="card" key={block.id}>
                        <div className="block-head">
                            <span className="num">{block.ordinal}</span>
                            <div>
                                <h2>{block.title}</h2>
                                {block.rationale ? <div className="why">Почему так: {block.rationale}</div> : null}
                            </div>
                        </div>

                        {program ? (
                            <>
                                <div className="main-task">
                                    <span className="lbl">Главная задача</span>
                                    <p>{program.main_task || '— не сформулирована —'}</p>
                                    <div className="muted">
                                        Руководитель: {program.manager_name || '— не назначен —'}
                                        {program.source === 'tamara' ? ' · черновик Тамары' : ''}
                                    </div>
                                </div>

                                {problems.length > 0 ? (
                                    <ul className="problems">
                                        {problems.map((p, i) => (
                                            <li key={i} className={p.kind}>
                                                <b>{p.short}.</b> {p.say}
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}

                                {kindsSorted.map((kind) => {
                                    const group = own
                                        .filter((t) => t.kind === kind.code)
                                        .sort((a, b) => a.ordinal - b.ordinal);
                                    if (group.length === 0) return null;
                                    return (
                                        <div className="grp" key={kind.code}>
                                            <h3>
                                                {kind.title}
                                                <span className="hint">{kind.hint}</span>
                                            </h3>
                                            <ol>
                                                {group.map((t) => (
                                                    <li key={t.id}>
                                                        {t.text}
                                                        {t.why ? <span className="why">{t.why}</span> : null}
                                                        {kind.code === 'proizvodstvennaya' ? (
                                                            <span className="metric">
                                                                {t.metric ? `${t.metric}: ` : ''}
                                                                {t.target_value ? (
                                                                    <b>{t.target_value}</b>
                                                                ) : (
                                                                    <i className="blank">число ещё не замерено</i>
                                                                )}
                                                                {t.fact_value ? ` · факт ${t.fact_value}` : ''}
                                                                {!t.target_value && t.source_note
                                                                    ? ` — берётся из: ${t.source_note}`
                                                                    : ''}
                                                            </span>
                                                        ) : null}
                                                    </li>
                                                ))}
                                            </ol>
                                        </div>
                                    );
                                })}
                            </>
                        ) : (
                            <div className="empty-inline">
                                Программы под этот блок нет.
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => askProgram(block.id)}
                                    disabled={busy === `program-${block.id}`}
                                >
                                    {busy === `program-${block.id}` ? 'Тамара считает шаги назад…' : 'Написать программу'}
                                </button>
                            </div>
                        )}
                    </section>
                );
            })}

            {draftProgram ? (
                <section className="card draft">
                    <h2>Черновик программы</h2>
                    <div className="main-task">
                        <span className="lbl">Главная задача</span>
                        <p>{draftProgram.program.mainTask}</p>
                        <div className="muted">Руководитель: {draftProgram.program.managerName}</div>
                    </div>

                    {draftProgram.problems.length > 0 ? (
                        <ul className="problems">
                            {draftProgram.problems.map((p, i) => (
                                <li key={i} className={p.kind}>
                                    <b>{p.short}.</b> {p.say}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="muted">Проверки методички программа проходит. Существо оцениваешь ты.</p>
                    )}

                    {kindsSorted.map((kind) => {
                        const group = draftProgram.program.tasks
                            .filter((t) => t.kind === kind.code)
                            .sort((a, b) => a.ordinal - b.ordinal);
                        if (group.length === 0) return null;
                        return (
                            <div className="grp" key={kind.code}>
                                <h3>
                                    {kind.title}
                                    <span className="hint">{kind.hint}</span>
                                </h3>
                                <ol>
                                    {group.map((t, i) => (
                                        <li key={i}>
                                            {t.text}
                                            {t.why ? <span className="why">{t.why}</span> : null}
                                            {kind.code === 'proizvodstvennaya' ? (
                                                <span className="metric">
                                                    {t.metric ? `${t.metric}: ` : ''}
                                                    {t.targetValue ? (
                                                        <b>{t.targetValue}</b>
                                                    ) : (
                                                        <i className="blank">число ещё не замерено</i>
                                                    )}
                                                    {!t.targetValue && t.sourceNote ? ` — берётся из: ${t.sourceNote}` : ''}
                                                </span>
                                            ) : null}
                                        </li>
                                    ))}
                                </ol>
                            </div>
                        );
                    })}

                    <div className="row">
                        <button className="btn btn-primary" onClick={saveProgram} disabled={busy === 'save-program'}>
                            Сохранить программу
                        </button>
                        <button className="btn" onClick={() => setDraftProgram(null)}>
                            Отказаться
                        </button>
                    </div>
                </section>
            ) : null}

            {blocks.length > 0 && !draftBlocks ? (
                <button className="btn btn-sm" onClick={askBlocks} disabled={busy === 'blocks'}>
                    Пересмотреть нарезку
                </button>
            ) : null}
        </>
    );
}
