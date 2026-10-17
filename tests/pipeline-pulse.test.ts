/**
 * Сторож конвейера: тревога только по поломке.
 *
 * Повод. 17.10.2026, суббота: владельцу каждые 15 минут приходило «Конвейер ОКК
 * встал — очередь ничего не доделала за 13 ч». Накануне воркеры перевели на рабочее
 * время, и молчание очереди в выходной стало нормой, а не аварией. Сообщение,
 * которое приходит, когда всё в порядке, перестают читать — и пропускают настоящее.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Row = Record<string, any>;
const tables: Record<string, Row[]> = {
    email_ingest_state: [],
    incoming_emails: [],
    system_jobs: [],
};

vi.mock('@/utils/supabase', () => {
    const from = (name: string) => {
        const filters: Array<(row: Row) => boolean> = [];
        let sortColumn: string | null = null;
        let ascending = true;
        let max = Infinity;

        // Точный счёт (head: true) предела выдачи не знает — как в PostgREST.
        const rows = (ignoreLimit = false) => {
            let result = (tables[name] || []).filter((row) => filters.every((check) => check(row)));
            if (sortColumn) {
                const column = sortColumn;
                result = [...result].sort((a, b) => {
                    const left = String(a[column] ?? '');
                    const right = String(b[column] ?? '');
                    return (left < right ? -1 : left > right ? 1 : 0) * (ascending ? 1 : -1);
                });
            }
            return ignoreLimit ? result : result.slice(0, max);
        };

        let headCount = false;

        const query: any = {
            select: (_columns?: string, options?: { count?: string; head?: boolean }) => {
                headCount = Boolean(options?.head);
                return query;
            },
            eq(column: string, value: any) {
                filters.push((row) => String(row[column]) === String(value));
                return query;
            },
            lte(column: string, value: any) {
                filters.push((row) => String(row[column]) <= String(value));
                return query;
            },
            not(column: string) {
                filters.push((row) => row[column] !== null && row[column] !== undefined);
                return query;
            },
            order(column: string, options?: { ascending?: boolean }) {
                sortColumn = column;
                ascending = options?.ascending !== false;
                return query;
            },
            limit(value: number) {
                max = value;
                return query;
            },
            maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
            then: (resolve: any) =>
                headCount
                    ? resolve({ data: null, count: rows(true).length, error: null })
                    : resolve({ data: rows(), error: null }),
        };

        return query;
    };

    return { supabase: { from } };
});

const { collectPipelinePulse } = await import('@/lib/pipeline-pulse');

/** Суббота, 12:20 МСК: почта ходит, очередь по расписанию отдыхает. */
const SATURDAY = new Date('2026-10-17T09:20:00Z');

function setNow(now: Date) {
    vi.useFakeTimers();
    vi.setSystemTime(now);
}

function freshEmailPoll(now: Date) {
    tables.email_ingest_state = [{ last_run_at: new Date(now.getTime() - 2 * 60_000).toISOString() }];
    tables.incoming_emails = [];
}

beforeEach(() => {
    tables.email_ingest_state = [];
    tables.incoming_emails = [];
    tables.system_jobs = [];
});

afterEach(() => {
    vi.useRealTimers();
});

describe('пульс конвейера', () => {
    it('молчит в выходной, когда исполнитель по расписанию не приходил', async () => {
        setNow(SATURDAY);
        freshEmailPoll(SATURDAY);

        // Баллы ОКК считаются «0 5,8,11,14 * * 1-5»: в субботу заходов нет.
        tables.system_jobs = [
            { job_type: 'order_score_refresh', status: 'queued', available_at: '2026-10-16T20:30:49Z' },
            { job_type: 'order_score_refresh', status: 'queued', available_at: '2026-10-16T20:31:49Z' },
            { job_type: 'order_score_refresh', status: 'completed', finished_at: '2026-10-16T15:39:55Z' },
        ];

        const pulse = await collectPipelinePulse();

        expect(pulse.problems).toEqual([]);
        expect(pulse.ok).toBe(true);
        expect(pulse.checks.find((check) => check.key === 'jobs:order_score_refresh')?.verdict).toBe(
            'waiting_schedule',
        );
    });

    it('называет верное число работ, даже когда их больше предела выдачи', async () => {
        setNow(SATURDAY);
        freshEmailPoll(SATURDAY);

        // 1 159 работ: выдача обрежется на тысяче, счёт обязан остаться точным.
        tables.system_jobs = Array.from({ length: 1159 }, (_, index) => ({
            job_type: 'order_score_refresh',
            status: 'queued',
            available_at: `2026-10-16T20:${String(index % 60).padStart(2, '0')}:00Z`,
        }));

        const pulse = await collectPipelinePulse();
        const check = pulse.checks.find((item) => item.key === 'jobs:order_score_refresh');

        // Разряды разделены неразрывным пробелом, поэтому сверяем по образцу.
        expect(check?.reason).toMatch(/1\s159 работ/);
    });

    it('молчит, когда очередь пуста — проверять нечего', async () => {
        setNow(SATURDAY);
        freshEmailPoll(SATURDAY);

        const pulse = await collectPipelinePulse();

        expect(pulse.problems).toEqual([]);
        expect(pulse.checks.find((check) => check.key === 'jobs_queue')?.verdict).toBe('idle');
    });

    it('кричит, когда исполнитель приходил по расписанию и работу не взял', async () => {
        setNow(SATURDAY);
        freshEmailPoll(SATURDAY);

        // Привязка звонков ходит каждую минуту: за полчаса она обязана была взять работу.
        tables.system_jobs = [
            { job_type: 'call_match', status: 'queued', available_at: '2026-10-17T08:50:00Z' },
            { job_type: 'call_match', status: 'completed', finished_at: '2026-10-17T08:00:00Z' },
        ];

        const pulse = await collectPipelinePulse();

        expect(pulse.ok).toBe(false);
        expect(pulse.problems).toHaveLength(1);
        expect(pulse.problems[0]).toContain('Привязка звонков к заказам');
        expect(pulse.problems[0]).toContain('не взял ни одной');
    });

    it('кричит, когда исполнитель работает, но за десятки заходов не разгрёб хвост', async () => {
        setNow(SATURDAY);
        freshEmailPoll(SATURDAY);

        tables.system_jobs = [
            { job_type: 'call_match', status: 'queued', available_at: '2026-10-17T08:00:00Z' },
            // Работа идёт — свежие работы доделываются, но до старой очередь не доходит.
            { job_type: 'call_match', status: 'completed', finished_at: '2026-10-17T09:19:00Z' },
        ];

        const pulse = await collectPipelinePulse();

        expect(pulse.ok).toBe(false);
        expect(pulse.problems[0]).toContain('очередь не разгрёб');
    });

    it('не трогает хвост от снятых с производства типов работ', async () => {
        setNow(SATURDAY);
        freshEmailPoll(SATURDAY);

        tables.system_jobs = [
            { job_type: 'retailcrm_order_upsert', status: 'queued', available_at: '2026-10-01T10:00:00Z' },
        ];

        const pulse = await collectPipelinePulse();

        expect(pulse.problems).toEqual([]);
        expect(pulse.checks.find((check) => check.key === 'jobs:retailcrm_order_upsert')?.verdict).toBe('idle');
    });

    it('кричит, когда приём почты замолчал', async () => {
        setNow(SATURDAY);
        tables.email_ingest_state = [{ last_run_at: '2026-10-17T07:00:00Z' }];

        const pulse = await collectPipelinePulse();

        expect(pulse.ok).toBe(false);
        expect(pulse.problems[0]).toContain('Приём почты');
    });

    it('кричит, когда письма лежат без разбора дольше норматива', async () => {
        setNow(SATURDAY);
        freshEmailPoll(SATURDAY);
        tables.incoming_emails = [{ status: 'new', created_at: '2026-10-17T05:00:00Z' }];

        const pulse = await collectPipelinePulse();

        expect(pulse.ok).toBe(false);
        expect(pulse.problems[0]).toContain('Письма без разбора');
    });
});
