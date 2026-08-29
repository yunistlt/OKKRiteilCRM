import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
    const { getTamaraPrompt, runTamara } = await import('@/lib/shtab/tamara');
    const prompt = await getTamaraPrompt('shtab_tamara_chat');
    console.log('модель:', prompt.model, '\n');

    const answer = await runTamara({
        prompt,
        userContent: process.argv[2] || 'План на август 13 млн. Выполним ли? Посчитай факт, найди причину и скажи, что делать.',
        purpose: 'проверка аналитических способностей',
    });

    console.log('=== ЧЕМ ПОЛЬЗОВАЛАСЬ ===');
    for (const t of answer.usedTools) console.log(' •', t.name, JSON.stringify(t.args).slice(0, 160));
    console.log('\n=== ОТВЕТ ===\n' + answer.reply);
}

main().catch((e) => { console.error(e); process.exit(1); });
