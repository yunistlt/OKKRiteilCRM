import { MODULE_TITLES, findKnob, listKnobs, type ModuleId } from '@/lib/settings-registry';
import { createProposal, describeProposal, listProposals } from '@/lib/settings-registry/proposals';
import { nextMonthStart } from '@/lib/settings-registry/salary';

/**
 * Настройки сервиса глазами Тамары.
 *
 * Раньше «подними нагрузку на девочек на 5%» она не понимала вовсе: о том, что
 * у отдела продаж есть бот с ежедневными задачами и у него есть множитель
 * нагрузки, ей знать было неоткуда. Её инструменты кончались на Штабе.
 *
 * Правило одно и оно здесь главное: МЕНЯТЬ настройки Тамара не может. Она
 * находит нужную ручку, объясняет, что произойдёт, и оставляет предложение.
 * Применяет его владелец нажатием — потому что настройка бота назавтра уезжает
 * живым людям в телегу, а цена неверно понятой фразы — их рабочий день.
 */

type ToolResult = Record<string, unknown>;

const MODULE_ENUM = Object.keys(MODULE_TITLES) as ModuleId[];

export const SETTINGS_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'settings_catalog',
            description:
                'Найти настройку сервиса: что за ручка, что она делает, какое значение стоит сейчас. Здесь ежедневные задачи отдела продаж (бот-РОП: нагрузка, нормы, напоминания), мотивация (ставки, коэффициенты, премии), план продаж на месяц и правила качества ОКК. Вызывай всегда, когда просят что-то изменить, усилить, ослабить, поднять или снизить в работе отдела: сначала найди ручку и её текущее значение, а потом считай новое от него.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Слова из вопроса человека: «нагрузка», «задачи в день», «ставка заявка», «план месяца».',
                    },
                    module: {
                        type: 'string',
                        enum: MODULE_ENUM,
                        description: 'Ограничить подсистемой, если уже ясно какой.',
                    },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'settings_propose',
            description:
                'Предложить изменить настройку. Ничего не применяется: владелец увидит карточку и нажмёт «применить» или «отклонить». Перед вызовом обязательно возьми текущее значение через settings_catalog и посчитай новое от него — «на 5% больше» считается от того, что стоит сейчас, а не от единицы. В reason напиши одной фразой, что изменится для людей; в evidence — числа, на которые опираешься.',
            parameters: {
                type: 'object',
                properties: {
                    knob_id: { type: 'string', description: 'Адрес ручки из settings_catalog, например sales_rop.load_factor.' },
                    new_value: { type: 'string', description: 'Новое значение в том же виде, в каком показано текущее.' },
                    reason: { type: 'string', description: 'Что это даст и что изменится для людей.' },
                    evidence: { type: 'string', description: 'На какие числа опираешься — их владелец проверит.' },
                    effective_from: {
                        type: 'string',
                        description:
                            'Для мотивации: с какой даты действует, ГГГГ-ММ-ДД. Закрытые периоды не пересчитываются, поэтому по умолчанию первое число следующего месяца.',
                    },
                },
                required: ['knob_id', 'new_value', 'reason'],
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'settings_proposals',
            description:
                'Мои предложения по настройкам и что с ними стало: ждёт решения, применено, отклонено. Вызывай, когда спрашивают «ну что, поменяли?» или прежде чем предлагать то же самое второй раз.',
            parameters: {
                type: 'object',
                properties: {
                    status: { type: 'string', enum: ['pending', 'applied', 'rejected', 'failed'] },
                },
            },
        },
    },
] as const;

export const SETTINGS_TOOL_NAMES: ReadonlySet<string> = new Set<string>(SETTINGS_TOOLS.map((t) => t.function.name));

export async function executeSettingsTool(
    name: string,
    args: any,
    ctx: { conversationId?: number | null } = {},
): Promise<ToolResult> {
    try {
        if (name === 'settings_catalog') {
            const { items, failed } = await listKnobs({
                query: args?.query ? String(args.query) : undefined,
                module: args?.module as ModuleId | undefined,
            });

            // Каталог целиком в ответ не влезает и не нужен: человек спрашивает
            // про одну ручку. Но молчаливо обрезанный список модель приняла бы
            // за полный, поэтому говорим, сколько осталось за кадром.
            const shown = items.slice(0, 25);
            return {
                found: items.length,
                shown: shown.length,
                modules: MODULE_TITLES,
                knobs: shown.map((k) => ({
                    knob_id: k.id,
                    module: MODULE_TITLES[k.module],
                    group: k.group,
                    title: k.title,
                    hint: k.hint,
                    unit: k.unit,
                    current_value: k.value || null,
                    effective_dated: k.effectiveDated ?? false,
                })),
                ...(items.length > shown.length
                    ? { note: `Показаны не все: ещё ${items.length - shown.length}. Уточни запрос.` }
                    : {}),
                ...(failed.length ? { unavailable: failed } : {}),
            };
        }

        if (name === 'settings_propose') {
            const knobId = String(args?.knob_id ?? '').trim();
            const newValue = String(args?.new_value ?? '').trim();
            const reason = String(args?.reason ?? '').trim();
            if (!knobId || !newValue || !reason) {
                return { ok: false, reason: 'Нужны knob_id, new_value и reason.' };
            }

            const knob = await findKnob(knobId);
            // Мотивация действует с даты. Дата по умолчанию — первое число
            // следующего месяца: правка задним числом меняет уже выплаченное.
            const effectiveFrom = knob.effectiveDated
                ? String(args?.effective_from || nextMonthStart())
                : undefined;

            const { proposal } = await createProposal({
                knobId,
                newValue,
                reason,
                evidence: args?.evidence ? String(args.evidence) : undefined,
                effectiveFrom,
                conversationId: ctx.conversationId ?? null,
            });

            return {
                ok: true,
                proposal_id: proposal.id,
                what: describeProposal(proposal),
                applied: false,
                note: 'Предложение показано владельцу карточкой. Скажи ему, что именно изменится, и что применится оно только после его нажатия.',
            };
        }

        if (name === 'settings_proposals') {
            const items = await listProposals({ status: args?.status });
            return {
                proposals: items.map((p) => ({
                    proposal_id: p.id,
                    what: describeProposal(p),
                    status: p.status,
                    reason: p.reason,
                    created_at: p.created_at,
                    decided_by: p.decided_by,
                    error: p.error,
                })),
            };
        }

        return { available: false, reason: `Неизвестный инструмент настроек: ${name}` };
    } catch (e: any) {
        // Отказ возвращаем текстом, а не исключением: модель должна прочитать
        // причину и исправиться, а не уронить разговор.
        return { ok: false, reason: String(e?.message ?? e) };
    }
}
