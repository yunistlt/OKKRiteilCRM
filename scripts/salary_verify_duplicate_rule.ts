/**
 * Сверка SQL ↔ TS для правила «Дубль на тендер» + «не наша продукция».
 * Прогоняет июль 2026 двумя путями:
 *   • TS — экспортами lib/salary/tender-duplicates.ts (как в раскрытии ведомости);
 *   • SQL — через RPC salary_incoming_counts (как в расчёте конверсии).
 * Множества исключённых обязаны совпасть, иначе цифра и пояснение разойдутся.
 *
 * Гейт: любая правка правила (TS или SQL) обязана оставлять множества равными.
 *
 * Запуск: npx tsx -r dotenv/config scripts/salary_verify_duplicate_rule.ts dotenv_config_path=.env.local
 */
import { Client } from 'pg';
import {
    evaluateDuplicate,
    evaluateRequestDuplicate,
    extractReferencedNumber,
    isNotOurProduct,
    isTenderDuplicate,
    orderItemKeys,
    resolveDuplicateRoot,
    type ReferencedOrder,
    type TenderDuplicateRule,
    type NotOurProductRule,
} from '../lib/salary/tender-duplicates';

const START = '2026-07-01';
const END = '2026-08-01';

async function main() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
        ssl: { rejectUnauthorized: false },
    });
    await client.connect();

    const cfgRows = await client.query(
        `select key, value from salary_config
          where key in ('tender_duplicate_rule','not_our_product_rule','cancel_reason_field',
                        'request_duplicate_rule','conversion_excluded_statuses','source_exclusions',
                        'closing_status')
            and effective_from <= $1
          order by effective_from desc`,
        [START],
    );
    const cfg = new Map<string, any>();
    for (const r of cfgRows.rows) if (!cfg.has(r.key)) cfg.set(r.key, r.value);

    const rule = cfg.get('tender_duplicate_rule') as TenderDuplicateRule;
    const notOur = cfg.get('not_our_product_rule') as NotOurProductRule;
    const reasonField: string = cfg.get('cancel_reason_field').code;
    const reqStatus: string = cfg.get('request_duplicate_rule').duplicate_status;
    const excludedStatuses: string[] = cfg.get('conversion_excluded_statuses');
    const sourceExclusions: string[] = cfg.get('source_exclusions');
    const closing: string = cfg.get('closing_status').code;

    // ---------- TS-путь ----------
    const all = (
        await client.query(
            `select number, status, manager_id, raw_payload from orders where created_at >= $1 and created_at < $2`,
            [START, END],
        )
    ).rows;

    const cancelReasonOf = (p: any): string | null => p?.customFields?.[reasonField] ?? null;
    const toRef = (r: any): ReferencedOrder => ({
        number: String(r.number),
        status: String(r.status ?? ''),
        cancelReason: cancelReasonOf(r.raw_payload),
        managerComment: r.raw_payload?.managerComment ?? null,
        itemKeys: orderItemKeys(r.raw_payload),
        wonProduction: String(r.status ?? '') === closing || wonOrderIds.has(Number(r.order_id)),
    });

    // Заказы, когда-либо уходившие в производство (эталон выиграл тендер).
    const wonOrderIds = new Set<number>(
        (
            await client.query(
                `select distinct retailcrm_order_id from order_history_log
                  where field = 'status' and new_value like $1`,
                [`%"code":"${closing}"%`],
            )
        ).rows.map((r) => Number(r.retailcrm_order_id)),
    );

    // Эталоны (с разворотом цепочки), как в buildIncomingByManager.
    const refByNumber = new Map<string, ReferencedOrder>();
    let pending = new Set<string>();
    for (const o of all) {
        if (!isTenderDuplicate({ status: String(o.status ?? ''), cancelReason: cancelReasonOf(o.raw_payload) }, rule)) continue;
        const num = extractReferencedNumber(o.raw_payload?.managerComment);
        if (num) pending.add(num);
    }
    for (let depth = 0; depth <= 5 && pending.size; depth++) {
        const refs = (
            await client.query(`select order_id, number, status, raw_payload from orders where number = any($1)`, [Array.from(pending)])
        ).rows;
        const next = new Set<string>();
        for (const r of refs) {
            const ref = toRef(r);
            refByNumber.set(ref.number, ref);
            if (!isTenderDuplicate(ref, rule)) continue;
            const num = extractReferencedNumber(ref.managerComment);
            if (num && !refByNumber.has(num)) next.add(num);
        }
        pending = next;
    }

    // Существование эталонов для «дублей заявки» (там достаточно факта наличия заказа).
    const reqRefNumbers = new Set<string>();
    for (const o of all) {
        if (String(o.status ?? '') !== reqStatus) continue;
        const num = extractReferencedNumber(o.raw_payload?.managerComment);
        if (num) reqRefNumbers.add(num);
    }
    const refExists = new Set<string>(
        reqRefNumbers.size
            ? (await client.query(`select number from orders where number = any($1)`, [Array.from(reqRefNumbers)])).rows.map((r) =>
                  String(r.number),
              )
            : [],
    );

    const tsExcluded = new Set<string>();
    const tsNotOur = new Set<string>();
    const tsCounted: { number: string; reason: string | null }[] = [];
    let tsDenominator = 0;
    for (const o of all) {
        const st = String(o.status ?? '');
        const om = String(o.raw_payload?.orderMethod ?? '');
        if (sourceExclusions.includes(om)) continue;
        if (excludedStatuses.includes(st)) continue;
        const cancelReason = cancelReasonOf(o.raw_payload);
        if (isNotOurProduct({ status: st, cancelReason }, notOur)) {
            tsNotOur.add(String(o.number));
            continue;
        }
        if (!o.manager_id) continue;
        if (st === reqStatus) {
            // Ветка «дубль заявки» — правило прежнее, но в знаменателе учитывать надо
            // одинаково с RPC, иначе итог не сойдётся.
            const num = extractReferencedNumber(o.raw_payload?.managerComment);
            const v = evaluateRequestDuplicate(
                { status: st, managerComment: o.raw_payload?.managerComment ?? null },
                num ? refExists.has(num) : false,
                { duplicate_status: reqStatus },
            );
            if (!v.excluded) tsDenominator++;
            continue;
        }
        const num = extractReferencedNumber(o.raw_payload?.managerComment);
        const seed = num ? refByNumber.get(num) ?? null : null;
        const verdict = evaluateDuplicate(
            { status: st, cancelReason, managerComment: o.raw_payload?.managerComment ?? null, itemKeys: orderItemKeys(o.raw_payload) },
            seed ? resolveDuplicateRoot(seed, refByNumber, rule) : null,
            { rule, referenceStatusLabel: 'Тендер / Ожидание выхода тендера' },
        );
        if (verdict.excluded) tsExcluded.add(String(o.number));
        else {
            tsDenominator++;
            if (verdict.isDuplicate) tsCounted.push({ number: String(o.number), reason: verdict.reason });
        }
    }

    // ---------- SQL-путь ----------
    // Тот же предикат исключения дубля, что в RPC, но с номером заказа наружу.
    const sqlExcluded = new Set<string>(
        (
            await client.query(
                `select o.number
                   from orders o
                  where o.created_at >= $1 and o.created_at < $2
                    and (
                        o.status = $3
                        or coalesce(o.raw_payload->'customFields'->>$4, '') = any($5)
                    )
                    and exists (
                        select 1 from orders r
                         where r.number = public.salary_tender_duplicate_root(
                                   (regexp_match(o.raw_payload->>'managerComment', '(?:дубль|дубл|dubl)\\D*(\\d{3,6})', 'i'))[1],
                                   $3, $5, $4, 5)
                           and (
                                r.status = any($6)
                                or public.salary_order_won_production(r.order_id, r.status, $7)
                           )
                           and exists (
                               select 1
                                 from jsonb_array_elements(coalesce(o.raw_payload->'items','[]'::jsonb)) oi
                                 join jsonb_array_elements(coalesce(r.raw_payload->'items','[]'::jsonb)) ri
                                   on coalesce((ri->>'quantity')::numeric,0) = coalesce((oi->>'quantity')::numeric,0)
                                  and (
                                      coalesce(nullif(lower(btrim(ri->'offer'->>'xmlId')),''),'#ref')
                                          = coalesce(nullif(lower(btrim(oi->'offer'->>'xmlId')),''),'#dup')
                                   or coalesce(nullif(lower(btrim(ri->'offer'->>'article')),''),'#ref')
                                          = coalesce(nullif(lower(btrim(oi->'offer'->>'article')),''),'#dup')
                                   or coalesce(nullif(lower(btrim(ri->'offer'->>'externalId')),''),'#ref')
                                          = coalesce(nullif(lower(btrim(oi->'offer'->>'externalId')),''),'#dup')
                                  )
                           )
                    )`,
                [START, END, rule.duplicate_status, reasonField, rule.duplicate_cancel_reasons, rule.reference_statuses, closing],
            )
        ).rows.map((r) => String(r.number)),
    );

    const rpc = await client.query(
        `select sum(incoming)::int total from public.salary_incoming_counts($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [START, END, sourceExclusions, rule.duplicate_status, rule.reference_statuses, reqStatus,
         excludedStatuses, rule.duplicate_cancel_reasons, notOur.statuses, notOur.cancel_reasons, reasonField, closing],
    );

    // ---------- Сравнение ----------
    const onlyTs = Array.from(tsExcluded).filter((n) => !sqlExcluded.has(n));
    const onlySql = Array.from(sqlExcluded).filter((n) => !tsExcluded.has(n));

    console.log(`Дубли на тендер, исключено: TS ${tsExcluded.size} / SQL ${sqlExcluded.size}`);
    console.log(`Только в TS: ${onlyTs.join(', ') || '—'}`);
    console.log(`Только в SQL: ${onlySql.join(', ') || '—'}`);
    console.log(`«Не наша продукция» вне знаменателя: ${tsNotOur.size}`);
    console.log(`Знаменатель: TS ${tsDenominator} / RPC ${rpc.rows[0].total}`);
    console.log('\nОстаются учтёнными (дубли, не прошедшие правило):');
    for (const c of tsCounted.sort((a, b) => a.number.localeCompare(b.number))) {
        console.log(`  ${c.number} — ${c.reason}`);
    }
    console.log('\nКонтроль по разбору ОКК:');
    for (const n of ['53977', '53848', '53751', '53746', '53827', '53722', '53678', '53753', '53755', '53693', '53757', '53761', '53929', '53700', '53714', '53842']) {
        const where = tsExcluded.has(n) ? 'исключён (дубль)' : tsNotOur.has(n) ? 'исключён (не наша продукция)' : 'учтён';
        console.log(`  ${n}: ${where}`);
    }

    await client.end();
    if (onlyTs.length || onlySql.length) process.exitCode = 1;
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
