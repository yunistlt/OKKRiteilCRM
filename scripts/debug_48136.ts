
import { analyzeOrderForRouting } from '../lib/ai-router';
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function debugOrder48136() {
    const orderId = 48136;

    // Get statuses for mapping
    const { data: statuses } = await supabase
        .from('statuses')
        .select('code, name, is_working, group_name')
        .eq('is_active', true)
        .or('group_name.ilike.%отмен%,group_name.ilike.%согласован%,group_name.ilike.%тендер%,group_name.ilike.%оплат%,group_name.ilike.%новый%,is_working.eq.true');

    const statusMap = new Map(statuses?.map(s => [s.code, s.name]) || []);

    const rawComment = `шкафчики для Лада Ларгус, попросил написать ему в ватсапе, сейчас времени у него нет общаться, ответит 11.08 общаться, ответит 11.08 скинула картинки варианты 12.08 прислал фото кузова внутри нужно так же стойку под баллоны 14.08 отп расчет на вотсап просил смотрит 15.08 Принято , мне нужно на след неделе дам отче 13.10 недоступен 1.11 нашли слесаря и сделали из дерева полки`;

    console.log('🔍 Debugging order #48136...\n');
    console.log('--- Raw Comment ---');
    console.log(rawComment);
    console.log('-------------------\n');

    const decision = await analyzeOrderForRouting(rawComment, statusMap, {
        currentTime: '2026-01-11T19:00:00Z',
        orderUpdatedAt: '2026-01-11T18:56:15Z'
    });

    console.log('🤖 AI Decision:');
    console.log(`  Target Status: ${decision.target_status} (${statusMap.get(decision.target_status)})`);
    console.log(`  Confidence: ${Math.round(decision.confidence * 100)}%`);
    console.log(`  Reasoning: ${decision.reasoning}`);
}

debugOrder48136();
