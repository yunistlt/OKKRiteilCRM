import { describe, expect, it } from 'vitest';
import { SHTAB_TOOLS } from '@/lib/shtab/tamara-tools';
import { TASK_KINDS } from '@/lib/shtab/programs';

function tool(name: string): any {
    return SHTAB_TOOLS.find((t: any) => t.function.name === name);
}

describe('инструмент записи разбора', () => {
    it('объявлен и берёт список операций', () => {
        const t = tool('shtab_razbor_write');
        expect(t, 'инструмента нет').toBeTruthy();
        expect(t.function.parameters.required).toContain('operations');
    });

    it('типы задач в схеме совпадают со справочником', () => {
        // Схема инструмента перечисляет типы задач списком, и он обязан
        // совпадать с TASK_KINDS: разошлись — модель пришлёт тип, который
        // молча отфильтруется, и программа останется без производственных
        // задач, то есть ровно с тем браком, ради которого слой и заведён.
        const props = tool('shtab_razbor_write').function.parameters.properties.operations.items.properties;
        const kinds: string[] = props.tasks.items.properties.kind.enum;
        expect([...kinds].sort()).toEqual([...TASK_KINDS].sort());
    });

    it('операции ограничены четырьмя и разбор среди них не создаётся', () => {
        // Разбор заводит владелец: он начинается с минуса и области.
        const props = tool('shtab_razbor_write').function.parameters.properties.operations.items.properties;
        expect(props.op.enum).toEqual(['set_strategy', 'set_goal', 'create_block', 'save_program']);
    });
});

describe('пишущие инструменты вообще', () => {
    it('их ровно столько, сколько разрешено — и минусов с проектами среди них нет', () => {
        // Список сверяется целиком: новый пишущий инструмент должен появляться
        // осознанно, а не проезжать вместе с соседней правкой.
        const writers = SHTAB_TOOLS.map((t: any) => t.function.name).filter((n: string) =>
            /apply|write|import/.test(n),
        );
        expect(writers.sort()).toEqual(['shtab_import_staff_doc', 'shtab_razbor_write', 'shtab_structure_apply']);
    });
});
