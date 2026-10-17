/**
 * Сторож карты «тип работ → воркер → расписание».
 *
 * Карта нужна сторожу конвейера, чтобы отличать поломку от «исполнителю ещё рано».
 * Разъехавшаяся карта тиха и опасна: незнакомый тип работ просто перестаёт
 * проверяться. Поэтому реестр сверяется с роутами воркеров и с кронами в vercel.json.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SYSTEM_JOB_WORKERS, describeJobType, getCronScheduleForPath } from '@/lib/system-job-workers';
import { parseCron } from '@/lib/cron-schedule';

const root = path.resolve(__dirname, '..');
const workersDir = path.join(root, 'app/api/cron/system-jobs');

/** Типы работ, которые роут воркера забирает из очереди: читаем прямо из кода роутов. */
function readJobTypesFromRoutes(): Map<string, string[]> {
    const map = new Map<string, string[]>();

    for (const slug of fs.readdirSync(workersDir)) {
        const routeFile = path.join(workersDir, slug, 'route.ts');
        if (!fs.existsSync(routeFile)) continue;

        const source = fs.readFileSync(routeFile, 'utf8');
        const matches = source.matchAll(/jobTypes:\s*\[([^\]]*)\]/g);
        const types: string[] = [];

        for (const match of matches) {
            for (const raw of match[1].split(',')) {
                const value = raw.trim().replace(/^['"]|['"]$/g, '');
                if (value) types.push(value);
            }
        }

        if (types.length) map.set(`/api/cron/system-jobs/${slug}`, Array.from(new Set(types)));
    }

    return map;
}

describe('карта типов работ и их исполнителей', () => {
    it('каждый тип из роута воркера есть в реестре и указывает на этот же роут', () => {
        for (const [cronPath, jobTypes] of readJobTypesFromRoutes()) {
            for (const jobType of jobTypes) {
                const worker = (SYSTEM_JOB_WORKERS as Record<string, { cronPath: string | null; retired?: boolean }>)[
                    jobType
                ];
                expect(worker, `тип «${jobType}» не описан в SYSTEM_JOB_WORKERS`).toBeDefined();

                // Роут воркера может лежать без крона: так осталось от RetailCRM после
                // отвязки 05.10.2026. Тогда тип обязан быть помечен снятым с производства —
                // иначе сторож будет ждать исполнителя, которого никто не вызывает.
                if (getCronScheduleForPath(cronPath)) {
                    expect(worker.cronPath, `тип «${jobType}» указывает не на свой роут`).toBe(cronPath);
                } else {
                    expect(worker.cronPath, `у роута ${cronPath} нет крона — тип не должен ссылаться на него`).toBeNull();
                    expect(worker.retired, `тип «${jobType}» без крона, но не помечен снятым`).toBe(true);
                }
            }
        }
    });

    it('у каждого названного роута есть крон, и его расписание разбирается', () => {
        for (const [jobType, worker] of Object.entries(SYSTEM_JOB_WORKERS)) {
            if (!worker.cronPath) continue;

            const schedule = getCronScheduleForPath(worker.cronPath);
            expect(schedule, `для «${jobType}» нет крона ${worker.cronPath} в vercel.json`).toBeTruthy();
            expect(() => parseCron(String(schedule))).not.toThrow();
            expect(describeJobType(jobType).spec).not.toBeNull();
        }
    });

    it('имена типов работ человеческие, без технических слагов', () => {
        for (const [jobType, worker] of Object.entries(SYSTEM_JOB_WORKERS)) {
            expect(worker.title, `тип «${jobType}» без человеческого имени`).toMatch(/[а-яё]/i);
            expect(worker.title).not.toContain('_');
        }
    });
});
