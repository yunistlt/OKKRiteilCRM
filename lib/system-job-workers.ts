/**
 * Кто выполняет каждый тип работ и по какому расписанию.
 *
 * Зачем отдельным файлом. Сторож конвейера обязан отличать «исполнитель приходил и
 * не справился» от «исполнителю по расписанию ещё рано». Для этого ему нужно знать
 * пару: тип работ → воркер, и расписание этого воркера. Расписание не дублируем —
 * берём из vercel.json, единственного места, где оно настоящее.
 *
 * Соответствие проверяется тестом tests/system-job-workers.test.ts: он сверяет
 * реестр с роутами воркеров и с кронами, чтобы карта не разъехалась с жизнью.
 */
import vercelConfig from '@/vercel.json';
import { CronSpec, tryParseCron } from '@/lib/cron-schedule';
import type { SystemJobType } from '@/lib/system-jobs';

export type SystemJobWorker = {
    /** Человеческое имя типа работ — для сообщения владельцу */
    title: string;
    /** Путь крон-роута, который разбирает этот тип. null — очередь этот тип не разбирает */
    cronPath: string | null;
    /**
     * true — тип снят с производства: работ такого типа больше никто не ставит и не
     * ждёт. Накопившийся хвост таких работ — не авария, а наследство.
     */
    retired?: boolean;
};

export const SYSTEM_JOB_WORKERS: Record<SystemJobType, SystemJobWorker> = {
    call_match: { title: 'Привязка звонков к заказам', cronPath: '/api/cron/system-jobs/call-match' },
    call_transcription: { title: 'Расшифровка звонков', cronPath: '/api/cron/system-jobs/transcription' },
    call_semantic_rules: { title: 'Разбор звонков правилами', cronPath: '/api/cron/system-jobs/call-semantic-rules' },
    order_insight_refresh: { title: 'Сводка по заказу', cronPath: '/api/cron/system-jobs/order-insight-refresh' },
    order_score_refresh: { title: 'Баллы ОКК по заказам', cronPath: '/api/cron/system-jobs/score-refresh' },
    manager_aggregate_refresh: {
        title: 'Показатели менеджеров',
        cronPath: '/api/cron/system-jobs/manager-aggregate-refresh',
    },
    nightly_reconciliation: { title: 'Ночная сверка', cronPath: '/api/cron/system-jobs/nightly-reconciliation' },
    telphin_callback: { title: 'Обратный звонок', cronPath: '/api/cron/system-jobs/telphin-callback' },
    salary_estimate_classify: {
        title: 'Разметка смет для зарплаты',
        cronPath: '/api/cron/system-jobs/salary-estimate-classify',
    },
    email_sent_append: { title: 'Копия письма в «Отправленные»', cronPath: '/api/cron/system-jobs/email-sent-append' },
    email_scheduled_send: { title: 'Отложенная отправка писем', cronPath: '/api/cron/system-jobs/email-scheduled-send' },

    // Приём изменений из RetailCRM выключен 05.10.2026 (ОКК — единственная система
    // учёта). Роуты воркеров ещё лежат, но кронов у них нет и новых работ никто не
    // ставит: хвост таких работ тревоги не стоит.
    retailcrm_order_delta_pull: { title: 'Заказы из RetailCRM', cronPath: null, retired: true },
    retailcrm_history_delta_pull: { title: 'История заказов из RetailCRM', cronPath: null, retired: true },
    retailcrm_order_upsert: { title: 'Запись заказа из RetailCRM', cronPath: null, retired: true },
    retailcrm_order_context_refresh: { title: 'Контекст заказа из RetailCRM', cronPath: null, retired: true },
    telphin_call_upsert: { title: 'Приём звонков Телфина', cronPath: null, retired: true },

    // Юридические разборы идут своим роутом по кнопке, а не из очереди.
    legal_contract_analyze: { title: 'Разбор договора', cronPath: null, retired: true },
    legal_contract_scan: { title: 'Проверка договора на вирусы', cronPath: null, retired: true },
    legal_enforcement_parse: { title: 'Разбор исполнительного производства', cronPath: null, retired: true },
};

/** Расписания кронов из vercel.json: путь без параметров → выражение. */
function buildScheduleIndex(): Map<string, string> {
    const index = new Map<string, string>();

    for (const cron of (vercelConfig as { crons?: Array<{ path: string; schedule: string }> }).crons || []) {
        const path = String(cron.path || '').split('?')[0];
        if (path) index.set(path, String(cron.schedule || ''));
    }

    return index;
}

const SCHEDULE_BY_PATH = buildScheduleIndex();

export function getCronScheduleForPath(cronPath: string): string | null {
    return SCHEDULE_BY_PATH.get(cronPath) ?? null;
}

export type JobTypeSchedule = {
    title: string;
    /** Расписание воркера. null — воркера по расписанию нет */
    spec: CronSpec | null;
    scheduleExpression: string | null;
    retired: boolean;
};

/**
 * Что известно про тип работ: как его зовут по-человечески и когда приходит исполнитель.
 * Незнакомый тип — тоже ответ: имя техническое, расписания нет.
 */
export function describeJobType(jobType: string): JobTypeSchedule {
    const worker = SYSTEM_JOB_WORKERS[jobType as SystemJobType];
    if (!worker) {
        return { title: jobType, spec: null, scheduleExpression: null, retired: false };
    }

    const expression = worker.cronPath ? getCronScheduleForPath(worker.cronPath) : null;

    return {
        title: worker.title,
        spec: expression ? tryParseCron(expression) : null,
        scheduleExpression: expression,
        retired: Boolean(worker.retired),
    };
}
