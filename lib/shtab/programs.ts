// Слой между стратегией и проектами: логические блоки, программы, задачи.
//
// По методичке «Альянс Стратег» (главы 38–40) стратегия не превращается в проекты
// напрямую. Её режут на логические блоки, под каждый блок пишут программу, и уже
// программа состоит из задач пяти типов. Раньше в Штабе этого слоя не было, и
// вместе с ним терялись производственные задачи — числа, к которым программа
// должна привести. Программа без чисел выполняется понарошку: всё сделано,
// отчитались, выпуска нет.
//
// Эти типы — общий словарь для всего слоя: их возвращает модель (по схеме
// структурированного вывода), по ним лежит образец в program-example.ts, их
// проверяет program-checks.ts и в них разбирает ответ база.

/** Пять типов задач. Коды технические, русские названия лежат в shtab_task_kind. */
export const TASK_KINDS = [
    'pervoocherednaya',   // подготовка: назначить, прочитать, взять ответственность
    'zhiznenno_vazhnaya', // правило, нарушение которого убивает программу
    'rabochaya',          // шаг к результату, получен обратным отсчётом
    'proizvodstvennaya',  // число, к которому надо прийти
    'uslovnaya',          // что делать, если пойдёт не так
] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

export type ProgramTask = {
    kind: TaskKind;
    /** Порядок внутри своего типа. У рабочих задач он несёт смысл: это последовательность. */
    ordinal: number;
    text: string;
    /**
     * Пояснение «почему так». Не у каждой задачи, но у жизненно важных почти
     * всегда: правило без причины выполняется формально.
     */
    why?: string;
    /** Что именно меряем. Только у производственных. */
    metric?: string;
    /**
     * Целевое значение. Пустая строка — это законный пропуск, но только вместе с
     * source_note: тогда видно, каким замером он закрывается. Пропуск без
     * указания источника — брак, это ловит program-checks.
     */
    targetValue?: string;
    /** Откуда берётся целевое значение: замер, инструмент, расчёт. */
    sourceNote?: string;
};

export type ProgramDraft = {
    /** Главная задача — РЕЗУЛЬТАТ, а не действие. «Покраска пропускает такт», не «расшить покраску». */
    mainTask: string;
    /** Ровно один. У задачи с двумя ответственными ответственных ноль. */
    managerName: string;
    tasks: ProgramTask[];
};

export type BlockDraft = {
    ordinal: number;
    title: string;
    /** Куски текста стратегии, попавшие в этот блок. Могут быть из разных её мест. */
    excerpt: string;
    /** Почему нарезано именно так. Владелец утверждает нарезку, значит должен видеть довод. */
    rationale: string;
};

// ── хранимые записи ───────────────────────────────────────────────────────────

export type ShtabBlock = BlockDraft & {
    id: number;
    razbor_id: number;
};

export type ShtabProgram = {
    id: number;
    block_id: number;
    main_task: string;
    manager_name: string;
    status: 'draft' | 'active' | 'done' | 'dropped';
    /** Кто составил черновик. Видно, где программа писана моделью, а где человеком. */
    source: 'tamara' | 'owner';
};

export type ShtabTask = ProgramTask & {
    id: number;
    program_id: number;
    /** Факт по производственной задаче: вводится вручную или подставляется инструментом. */
    factValue?: string;
    done: boolean;
    /** Рабочая задача может быть заведена проектом со сроком и владельцем. */
    projectId?: number | null;
};

/** Порядок групп на экране и в тексте программы — тот же, что в методичке. */
export const KIND_ORDER: Record<TaskKind, number> = {
    pervoocherednaya: 1,
    zhiznenno_vazhnaya: 2,
    rabochaya: 3,
    proizvodstvennaya: 4,
    uslovnaya: 5,
};

export function tasksOfKind(tasks: readonly ProgramTask[], kind: TaskKind): ProgramTask[] {
    return tasks.filter((t) => t.kind === kind).sort((a, b) => a.ordinal - b.ordinal);
}
