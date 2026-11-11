/**
 * Теневой прогон ИИ-РОПа: что бы он решил сегодня и чем это отличается от
 * плана по правилам.
 *
 * Нужен до включения: решение дня отдаётся модели, и прежде чем оно уйдёт
 * людям, его надо увидеть глазами — на живом пуле, по каждому менеджеру.
 *
 * По умолчанию модель НЕ зовётся: скрипт собирает пул, считает нормы и
 * показывает бриф, который ушёл бы Роману. Это бесплатно и проверяет первый
 * слой — факты. Вызов модели стоит денег, поэтому только с явным --ask.
 *
 *   npx tsx scripts/rop-chief-shadow.ts            # факты и бриф, без модели
 *   npx tsx scripts/rop-chief-shadow.ts --brief    # то же, целиком показать бриф
 *   npx tsx scripts/rop-chief-shadow.ts --ask      # спросить Романа (платный вызов)
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });

const args = process.argv.slice(2);
const ask = args.includes('--ask');
const showBrief = args.includes('--brief');

async function main() {
    const { loadSettings, loadPresaleOrders, loadManagerFactors, collectTasks, loadChiefShared, chiefContextFor } = await import(
        '../lib/sales-rop/service'
    );
    const { loadAbsences, absenceOn } = await import('../lib/sales-rop/absences');
    const { localToday } = await import('../lib/sales-rop/local-day');
    const { dayCapacity, longPlayRoom, ownTasks, taskBlock, taskKey } = await import('../lib/sales-rop/rules');
    const { loadTaskMemory } = await import('../lib/sales-rop/memory');
    const { renderChiefBrief, decideDay, applyChiefDecision } = await import('../lib/sales-rop/chief');
    const { supabase } = await import('../utils/supabase');

    const today = localToday();
    const settings = await loadSettings();
    const all = await loadPresaleOrders();
    const orders = all.filter((o) => !settings.excludedStatuses.includes(o.statusCode));

    const { data: intakeRows } = await supabase.rpc('sales_rop_daily_intake', { p_days: 30 });
    const intake = new Map<number | null, number>(
        ((intakeRows ?? []) as any[]).map((r) => [r.manager_id === null ? null : Number(r.manager_id), Number(r.per_day)]),
    );
    const personalLoad = await loadManagerFactors().catch(() => new Map<number | null, number>());

    const factor = Math.max(1, Math.round(settings.chiefPoolFactor));
    const absences = await loadAbsences();
    const plan = await collectTasks({ orders, today, t: settings, intake, personalLoad, absences });
    const pool = await collectTasks({
        absences,
        orders,
        today,
        t: {
            ...settings,
            dailyTarget: settings.dailyTarget * factor,
            tasksPerManager: settings.tasksPerManager * factor,
            coldPerDay: settings.coldPerDay * factor,
            devPerDay: settings.devPerDay * factor,
            clientTouchPerDay: settings.clientTouchPerDay * factor,
            cancelReturnPerDay: settings.cancelReturnPerDay * factor,
        },
        intake,
        personalLoad,
    });

    const names = new Map<number | null, string>();
    for (const o of orders) names.set(o.managerId, o.managerName);
    const nameById = new Map<number | null, { name: string; tg: string }>();
    for (const o of orders) nameById.set(o.managerId, { name: o.managerName, tg: o.telegram });
    const shared = await loadChiefShared(today, settings);

    console.log(`День ${today}. Пул шире нормы в ${factor} раза. Модель: ${ask ? 'спрашиваем' : 'НЕ зовём'}`);

    for (const [managerId, candidates] of Array.from(pool.entries())) {
        if (managerId === null || candidates.length === 0) continue;
        if (settings.planManagerIds.length > 0 && !settings.planManagerIds.includes(managerId)) continue;

        const who = names.get(managerId) ?? `менеджер ${managerId}`;
        const own = ownTasks(candidates);
        const cap = dayCapacity({ managerId, t: settings, ownCount: own.length, intakeByManager: intake, loadByManager: personalLoad });
        // Те же пределы, что в утреннем прогоне: иначе теневая проверка
        // показывает не то, что уйдёт людям.
        const limits = {
            live: cap.room,
            longPlay: longPlayRoom({ cap, ownCount: own.length, base: settings.devPerDay + settings.clientTouchPerDay }),
            minAlways: settings.minAlways,
            maxPostponeDays: settings.chiefMaxPostponeDays,
        };
        const rules = plan.get(managerId) ?? [];
        const memory = await loadTaskMemory(candidates.map((t) => t.orderId), { today, days: settings.chiefMemoryDays });

        console.log(`\n================ ${who} ================`);
        console.log(
            `Пул ${candidates.length} (живых ${candidates.filter((t) => taskBlock(t.reasonCode) === 'active').length},`
                + ` вдолгую ${candidates.filter((t) => taskBlock(t.reasonCode) === 'development').length}).`
                + ` Норма дня ${cap.dailyTarget}, своих звонков ${own.length}, заявок ${cap.intake}.`
                + ` Можно дать: живых ${limits.live}, вдолгую ${limits.longPlay}.`,
        );
        const inPlanRepeats = candidates.filter((t) => (memory.get(t.orderId)?.plans ?? 0) >= 5);
        const neverTalked = inPlanRepeats.filter((t) => (memory.get(t.orderId)?.calls ?? 0) === 0);
        console.log(
            `Память: пятый раз и больше в плане — ${inPlanRepeats.length} работ, из них без единого разговора ${neverTalked.length}.`,
        );

        console.log(`\nПЛАН ПО ПРАВИЛАМ (${rules.length}):`);
        for (const t of rules) {
            console.log(`  ${taskKey(t)} | ${t.client} | ${t.reasonCode} | ${t.reasonText}`);
        }

        const away = absenceOn(absences, managerId, today);
        if (away) console.log(`В ОТПУСКЕ до ${away.to} — плана нет.`);
        const context = chiefContextFor({ managerId, today, shared, absences, nameById });
        const brief = renderChiefBrief({ managerName: who, today, pool: candidates, memory, capacity: cap, limits, context });
        console.log(`\nБриф Роману: ${brief.length} знаков, примерно ${Math.round(brief.length / 3)} токенов.`);
        if (showBrief) console.log('\n--- БРИФ ---\n' + brief + '\n--- конец брифа ---');

        if (!ask) continue;

        const decided = await decideDay({ managerName: who, today, pool: candidates, memory, capacity: cap, limits, context });
        if (!decided) {
            console.log('РОП не ответил (нет промпта, нет ключа или ответ не разобрался).');
            continue;
        }
        const result = applyChiefDecision({ pool: candidates, decision: decided.decision, limits });
        console.log(`\nДЕНЬ ОТ РОПА (${result.tasks.length}), модель ${decided.model}:`);
        for (const t of result.tasks) {
            const a = result.assignments.get(taskKey(t));
            console.log(`  ${taskKey(t)} | ${t.client} | ${t.reasonCode}`);
            if (a) {
                console.log(`      цель: ${a.goal}`);
                console.log(`      сделать: ${a.action}`);
                if (a.ask) console.log(`      спросить: ${a.ask}`);
            }
        }
        if (result.postpone.length > 0) {
            console.log('\nОтложил:');
            for (const p of result.postpone) console.log(`  ${p.task.client} на ${p.days} дн. — ${p.why}`);
        }
        if (result.violations.length > 0) console.log('\nСторожа срезали: ' + result.violations.join('; '));
        if (result.note) console.log(`\nЗаписка менеджеру: ${result.note}`);

        const sameKeys = new Set(rules.map(taskKey));
        const added = result.tasks.filter((t) => !sameKeys.has(taskKey(t)));
        const dropped = rules.filter((t) => !new Set(result.tasks.map(taskKey)).has(taskKey(t)));
        console.log(
            `\nРасхождение с правилами: добавил ${added.length}, не взял ${dropped.length}.`,
        );
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
