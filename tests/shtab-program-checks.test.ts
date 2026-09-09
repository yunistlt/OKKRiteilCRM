import { describe, expect, it } from 'vitest';
import { checkProgram, countManagers, hasBlockingProblems, looksLikeInfinitive } from '@/lib/shtab/program-checks';
import { EXAMPLE_BLOCKS, EXAMPLE_PROGRAMS, FEW_SHOT_PROGRAMS } from '@/lib/shtab/program-example';
import { KIND_ORDER, TASK_KINDS, tasksOfKind } from '@/lib/shtab/programs';
import type { ProgramDraft } from '@/lib/shtab/programs';

const base = (): ProgramDraft => ({
    mainTask: 'Участок сдаёт заготовки в срок и без переделок, а очередь перед ним не растёт.',
    managerName: 'Начальник цеха по производству',
    tasks: [
        { kind: 'pervoocherednaya', ordinal: 1, text: 'Назначить руководителя программы приказом.' },
        { kind: 'zhiznenno_vazhnaya', ordinal: 1, text: 'Не запускать работы без утверждённой сметы.' },
        { kind: 'rabochaya', ordinal: 1, text: 'Замерить текущую пропускную способность участка за пять смен.' },
        { kind: 'rabochaya', ordinal: 2, text: 'Составить проект работ со сметой.' },
        { kind: 'rabochaya', ordinal: 3, text: 'Выполнить работы и повторить замер.' },
        {
            kind: 'proizvodstvennaya',
            ordinal: 1,
            text: 'Сдача в срок',
            metric: 'доля заказов',
            targetValue: 'не ниже 90 %',
        },
    ],
});

describe('образец, на котором учится Тамара', () => {
    it('все программы образца проходят собственные проверки', () => {
        // Если образец не проходит проверки — мы учим Тамару на браке, и она
        // будет уверенно воспроизводить именно его.
        for (const program of EXAMPLE_PROGRAMS) {
            const problems = checkProgram(program);
            expect(problems, `${program.mainTask.slice(0, 50)}: ${problems.map((p) => p.short).join('; ')}`).toEqual([]);
        }
    });

    it('в промпт уходят ровно две программы — длинная и короткая', () => {
        expect(FEW_SHOT_PROGRAMS).toHaveLength(2);
        const [long, short] = FEW_SHOT_PROGRAMS;
        expect(long.tasks.length).toBeGreaterThan(short.tasks.length);
    });

    it('образец показывает все пять типов задач', () => {
        const kinds = new Set(FEW_SHOT_PROGRAMS.flatMap((p) => p.tasks.map((t) => t.kind)));
        expect(kinds).toEqual(new Set(TASK_KINDS));
    });

    it('образец показывает законный пропуск: без числа, но с названным замером', () => {
        const blanks = EXAMPLE_PROGRAMS.flatMap((p) => tasksOfKind(p.tasks, 'proizvodstvennaya'))
            .filter((t) => !t.targetValue);
        expect(blanks.length).toBeGreaterThan(0);
        for (const t of blanks) expect(t.sourceNote?.trim()).toBeTruthy();
    });

    it('нарезка на блоки объясняет себя', () => {
        expect(EXAMPLE_BLOCKS.length).toBeGreaterThan(1);
        for (const b of EXAMPLE_BLOCKS) {
            expect(b.rationale.length, b.title).toBeGreaterThan(40);
            expect(b.excerpt.trim(), b.title).toBeTruthy();
        }
    });
});

describe('производственные задачи — главная проверка', () => {
    it('программа без них бракуется', () => {
        const p = base();
        p.tasks = p.tasks.filter((t) => t.kind !== 'proizvodstvennaya');
        const problems = checkProgram(p);
        expect(hasBlockingProblems(problems)).toBe(true);
        expect(problems.some((x) => x.at === 'proizvodstvennaya' && x.kind === 'bad')).toBe(true);
    });

    it('пропуск с названным замером проходит', () => {
        const p = base();
        p.tasks.push({
            kind: 'proizvodstvennaya',
            ordinal: 2,
            text: 'Простои по отказам',
            metric: 'часов в месяц',
            targetValue: '',
            sourceNote: 'базовый замер за три месяца, уменьшенный вдвое',
        });
        expect(checkProgram(p)).toEqual([]);
    });

    it('пропуск без источника — брак', () => {
        const p = base();
        p.tasks.push({ kind: 'proizvodstvennaya', ordinal: 2, text: 'Простои по отказам', targetValue: '', sourceNote: '' });
        expect(hasBlockingProblems(checkProgram(p))).toBe(true);
    });

    it('значение без числа — предупреждение, а не брак', () => {
        const p = base();
        p.tasks = p.tasks.map((t) =>
            t.kind === 'proizvodstvennaya' ? { ...t, targetValue: 'повысить' } : t,
        );
        const problems = checkProgram(p);
        expect(problems.some((x) => x.kind === 'warn' && x.at === 'proizvodstvennaya')).toBe(true);
        expect(hasBlockingProblems(problems)).toBe(false);
    });
});

describe('один руководитель', () => {
    it('должность, в названии которой есть «и», — это один человек', () => {
        // «Начальник цеха по качеству и технологическому процессу» — одна должность.
        const p = base();
        p.managerName = 'Начальник цеха по качеству и технологическому производственному процессу';
        expect(checkProgram(p)).toEqual([]);
    });

    it('запятая внутри описания должности — тоже один человек', () => {
        const p = base();
        p.managerName = 'Сотрудник, отвечающий за приём персонала';
        expect(checkProgram(p)).toEqual([]);
    });

    it('две должности бракуются', () => {
        const p = base();
        p.managerName = 'Начальник цеха по производству и начальник цеха по качеству';
        expect(hasBlockingProblems(checkProgram(p))).toBe(true);
    });

    it('две фамилии бракуются', () => {
        const p = base();
        p.managerName = 'Иванов, Петров';
        expect(hasBlockingProblems(checkProgram(p))).toBe(true);
    });

    it('countManagers считает сегменты, начинающиеся с должности', () => {
        expect(countManagers('Начальник цеха по качеству и технологическому процессу')).toBe(1);
        expect(countManagers('Сотрудник, отвечающий за приём персонала')).toBe(1);
        expect(countManagers('Начальник цеха по производству и начальник цеха по качеству')).toBe(2);
        expect(countManagers('Мастер участка / бригадир смены')).toBe(2);
        expect(countManagers('Иванов, Петров')).toBe(2);
        expect(countManagers('Иванов Иван Иванович')).toBe(1);
    });

    it('пустой руководитель бракуется', () => {
        const p = base();
        p.managerName = '';
        expect(hasBlockingProblems(checkProgram(p))).toBe(true);
    });
});

describe('главная задача — результат, а не действие', () => {
    it('действие помечается предупреждением', () => {
        const p = base();
        p.mainTask = 'Расшить узкое горло на покраске и выйти на требуемый такт выпуска.';
        const problems = checkProgram(p);
        expect(problems.some((x) => x.at === 'main' && x.kind === 'warn')).toBe(true);
    });

    it('результат проходит', () => {
        const p = base();
        p.mainTask = 'Покраска устойчиво пропускает объём, соответствующий требуемому такту.';
        expect(checkProgram(p)).toEqual([]);
    });

    it('пустая главная задача — брак', () => {
        const p = base();
        p.mainTask = '';
        expect(hasBlockingProblems(checkProgram(p))).toBe(true);
    });
});

describe('looksLikeInfinitive', () => {
    it('узнаёт инфинитивы', () => {
        for (const w of ['расшить', 'наладить', 'обеспечить', 'сформировать', 'организовать', 'привести', 'беречь']) {
            expect(looksLikeInfinitive(w), w).toBe(true);
        }
    });

    it('не путает существительные на «-ть»', () => {
        // На это окончание кончается целый пласт отглагольных существительных.
        for (const w of ['ответственность', 'область', 'часть', 'производительность', 'скорость', 'власть']) {
            expect(looksLikeInfinitive(w), w).toBe(false);
        }
    });

    it('пустая строка и обрывки', () => {
        expect(looksLikeInfinitive('')).toBe(false);
        expect(looksLikeInfinitive('   ')).toBe(false);
        expect(looksLikeInfinitive('ть')).toBe(false);
    });
});

describe('рабочие задачи', () => {
    it('меньше трёх — брак: это намерение, а не программа', () => {
        const p = base();
        p.tasks = p.tasks.filter((t) => t.kind !== 'rabochaya' || t.ordinal < 3);
        expect(hasBlockingProblems(checkProgram(p))).toBe(true);
    });

    it('больше двадцати пяти — предупреждение о нарезке', () => {
        const p = base();
        for (let i = 4; i <= 30; i += 1) p.tasks.push({ kind: 'rabochaya', ordinal: i, text: `Шаг номер ${i}.` });
        const problems = checkProgram(p);
        expect(problems.some((x) => x.at === 'rabochaya' && x.kind === 'warn')).toBe(true);
        expect(hasBlockingProblems(problems)).toBe(false);
    });
});

describe('подготовка и жизненно важные', () => {
    it('без первоочередных — предупреждение', () => {
        const p = base();
        p.tasks = p.tasks.filter((t) => t.kind !== 'pervoocherednaya');
        expect(checkProgram(p).some((x) => x.at === 'pervoocherednaya')).toBe(true);
    });

    it('без жизненно важных — предупреждение', () => {
        const p = base();
        p.tasks = p.tasks.filter((t) => t.kind !== 'zhiznenno_vazhnaya');
        expect(checkProgram(p).some((x) => x.at === 'zhiznenno_vazhnaya')).toBe(true);
    });
});

describe('порядок групп совпадает с методичкой', () => {
    it('первоочередные, жизненно важные, рабочие, производственные, условные', () => {
        expect(TASK_KINDS.map((k) => KIND_ORDER[k])).toEqual([1, 2, 3, 4, 5]);
    });
});

describe('границы слов в кириллице', () => {
    it('«сто» внутри «стоимости» и «простоя» не считается числом', () => {
        // Ловушка: в JavaScript «\b» определена через латинский \w и рядом с
        // кириллицей не работает. Без правильной границы производственная задача
        // «снизить стоимость» сошла бы за задачу с числом.
        const p = base();
        p.tasks = p.tasks.map((t) =>
            t.kind === 'proizvodstvennaya'
                ? { ...t, text: 'Снизить стоимость простоя', targetValue: 'уменьшить' }
                : t,
        );
        expect(checkProgram(p).some((x) => x.short === 'значение без числа')).toBe(true);
    });

    it('«сто процентов» словом считается числом', () => {
        const p = base();
        p.tasks = p.tasks.map((t) =>
            t.kind === 'proizvodstvennaya' ? { ...t, targetValue: 'сто процентов' } : t,
        );
        expect(checkProgram(p)).toEqual([]);
    });
});
