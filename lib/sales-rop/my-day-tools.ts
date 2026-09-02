import { supabase } from '@/utils/supabase';
import { classifyCall } from '@/lib/sales-rop/call-review';

// «Почему у меня двадцать, а не тридцать пять?»
//
// Цифра, которую нельзя разложить, вызывает не работу, а спор. Поэтому у Семёна
// есть инструменты, показывающие менеджеру его же день по строкам: каждый
// звонок с длительностью и отметкой, зачтён он или нет и почему; каждая задача
// из плана с отметкой, было ли по ней касание.
//
// Оба инструмента работают только по тому менеджеру, который спрашивает: чужой
// день — не его дело, и подглядывать за коллегой через бота нельзя.

const OFFSET_HOURS = 4; // Тольятти

function hhmm(v: string): string {
    return new Date(new Date(v).getTime() + OFFSET_HOURS * 3600_000).toISOString().slice(11, 16);
}

export const MY_DAY_TOOLS = [
    {
        type: 'function' as const,
        function: {
            name: 'my_calls',
            description:
                'Разбор звонков менеджера за день по строкам: во сколько, куда, сколько длился, зачтён ли как состоявшийся разговор и почему нет. Вызывай, когда спрашивают «почему у меня столько разговоров», «какие звонки не засчитали», «из чего сложилась цифра».',
            parameters: {
                type: 'object',
                properties: {
                    date: {
                        type: 'string',
                        description:
                            'Дата строго в виде ГГГГ-ММ-ДД, например 2026-08-28. Если человек назвал день словами («28 августа», «вчера», «в четверг») — переведи в эту форму сам. Без даты берётся сегодня, а сегодня может быть выходным.',
                    },
                },
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'my_tasks',
            description:
                'Задачи из плана менеджера за день с отметкой, было ли по каждой касание: номер заказа, клиент, сумма, причина попадания в план. Вызывай на вопросы «что мне засчитали», «почему написали, что я не отработал», «какие заказы были в плане».',
            parameters: {
                type: 'object',
                properties: {
                    date: {
                        type: 'string',
                        description: 'Дата строго в виде ГГГГ-ММ-ДД. День, названный словами, переводи сам.',
                    },
                },
            },
        },
    },
] as const;

export const MY_DAY_TOOL_NAMES: ReadonlySet<string> = new Set<string>(MY_DAY_TOOLS.map((t) => t.function.name));

function today(): string {
    return new Date(Date.now() + OFFSET_HOURS * 3600_000).toISOString().slice(0, 10);
}

export async function executeMyDayTool(name: string, args: any, managerId: number | null): Promise<any> {
    if (!managerId) return { available: false, reason: 'Не понял, чей это день — менеджер не определён' };

    // Дата должна быть в виде ГГГГ-ММ-ДД. Мусор вместо даты молча превращался бы
    // в «сегодня», и человек получил бы ответ про другой день, не заметив этого.
    const raw = String(args?.date ?? '').trim();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today();

    try {
        if (name === 'my_calls') {
            const { data, error } = await supabase.rpc('sales_rop_day_calls', {
                p_date: date,
                p_manager: String(managerId),
            });
            if (error) throw new Error(error.message);

            const calls = ((data ?? []) as any[]).map((r) => ({
                at: String(r.call_at),
                direction: r.direction,
                durationSec: Number(r.duration_sec ?? 0),
                phone: r.phone ?? null,
                orderNumber: r.order_number ?? null,
                transcript: r.transcript ?? null,
            }));

            // Причина отказа называется прямо: спор возникает там, где
            // непонятно, за что не засчитали.
            const WHY: Record<string, string> = {
                short: 'короче 15 секунд — не дозвонились',
                machine: 'автоответчик или голосовое меню, диалога не было',
                noise: 'в записи нет разговора: тишина или одно приветствие',
                no_transcript: 'записи разговора нет — подтвердить нечем',
            };

            const rows = calls.map((c) => {
                const verdict = classifyCall(c);
                return {
                    время: hhmm(c.at),
                    направление: c.direction,
                    длительность: `${c.durationSec} сек`,
                    телефон: c.phone,
                    заказ: c.orderNumber,
                    зачтён: verdict === 'talk',
                    почему: verdict === 'talk' ? null : WHY[verdict],
                };
            });

            return {
                дата: date,
                всего_звонков: rows.length,
                зачтено_разговоров: rows.filter((r) => r.зачтён).length,
                правило:
                    'Разговором считается звонок, в расшифровке которого подтверждён диалог с клиентом. ' +
                    'Автоответчик и голосовое меню не в счёт, даже если слушали их минуту.',
                звонки: rows,
            };
        }

        if (name === 'my_tasks') {
            const { data, error } = await supabase
                .from('sales_rop_task')
                .select('order_number, client, amount, reason_text, status_name, touched, touch_kind')
                .eq('plan_date', date)
                .eq('manager_id', managerId)
                .order('weight', { ascending: false });
            if (error) throw new Error(error.message);

            const rows = (data ?? []) as any[];
            return {
                дата: date,
                всего_задач: rows.length,
                отработано: rows.filter((r) => r.touched).length,
                правило: 'Задача считается отработанной, если по заказу в этот день был комментарий, смена статуса, письмо или звонок',
                задачи: rows.map((r) => ({
                    заказ: r.order_number,
                    клиент: r.client,
                    сумма: `${Math.round(Number(r.amount)).toLocaleString('ru-RU')} ₽`,
                    почему_в_плане: r.reason_text,
                    отработана: r.touched === true,
                    касание: r.touch_kind ?? null,
                })),
            };
        }

        return { available: false, reason: `Неизвестный инструмент: ${name}` };
    } catch (e: any) {
        return { available: false, reason: `Не удалось поднять данные: ${e.message}` };
    }
}
