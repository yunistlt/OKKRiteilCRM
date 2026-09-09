/**
 * Что реально отдаёт наш тариф Dadata.
 *
 * Поля выручки и штата в ответе есть всегда, но на бесплатном тарифе приходят
 * пустыми. Проверять надо не документацией, а живым ответом по компании, у
 * которой эти цифры точно существуют.
 *
 * Запуск: npx tsx scripts/check-dadata-fields.ts [ИНН]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
    const { companyByInn, isDadataConfigured } = await import('../lib/sales-rop/dadata');
    if (!isDadataConfigured()) throw new Error('нет ключа DADATA_API_KEY');

    // По умолчанию — крупные компании, у которых отчётность заведомо есть.
    const inns = process.argv[2] ? [process.argv[2]] : ['7736050003', '7707083893', '7728168971'];

    for (const inn of inns) {
        const c = await companyByInn(inn);
        if (!c) {
            console.log(`${inn}: ответа нет`);
            continue;
        }
        console.log(
            [
                c.name,
                `отрасль: ${c.activity ?? '—'}`,
                `регион: ${c.region ?? '—'}`,
                `филиалов: ${c.branches ?? '—'}`,
                `сотрудников: ${c.employees ?? 'ПУСТО'}`,
                `выручка: ${c.revenue ? c.revenue.toLocaleString('ru-RU') + ` ₽ (${c.revenueYear})` : 'ПУСТО'}`,
            ].join('\n  '),
            '\n',
        );
    }

    console.log('Если «сотрудников» и «выручка» пусты — тариф эти поля не отдаёт.');
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
