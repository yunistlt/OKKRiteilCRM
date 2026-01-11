
import { analyzeOrderForRouting } from '../lib/ai-router';
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function verifyFix() {
    const orderId = 47947;

    // Get statuses for mapping
    const { data: statuses } = await supabase
        .from('statuses')
        .select('code, name, is_working, group_name')
        .eq('is_active', true)
        .or('group_name.ilike.%отмен%,is_working.eq.true');

    const statusMap = new Map(statuses?.map(s => [s.code, s.name]) || []);

    console.log('📋 Available Statuses for AI:');
    statuses?.forEach(s => {
        console.log(`  - ${s.code}: ${s.name} (Group: ${s.group_name}, Working: ${s.is_working})`);
    });
    console.log('\n');

    // Original raw comment (with AI notes we want to strip)
    const rawComment = `ОКК: Комментарий содержит информацию о том, что заказ все еще в работе и ожидается ответ по габаритам для расчета доставки. Это указывает на необходимость согласования отмены.

29.07.2025 - с доставкой до терминала г.Липецк
ждем ответа по габаритам для расчета доставки
01.08. - отпр. на расчет Виктору
05.08.2025 - Уже выбрали поставщиков и отдали счета на оплату

ОКК: Комментарий содержит информацию о том, что заказ еще в работе и ожидается ответ по габаритам для расчета доставки. Это указывает на необходимость согласования отмены.`;

    console.log('🔍 Testing AI Analysis with logic fix...\n');
    console.log('--- Original Comment ---');
    console.log(rawComment);
    console.log('------------------------\n');

    const decision = await analyzeOrderForRouting(rawComment, statusMap);

    console.log('🤖 AI Decision:');
    console.log(`  Target Status: ${decision.target_status} (${statusMap.get(decision.target_status)})`);
    console.log(`  Confidence: ${Math.round(decision.confidence * 100)}%`);
    console.log(`  Reasoning: ${decision.reasoning}`);
}

verifyFix();
