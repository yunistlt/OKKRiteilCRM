import { searchProductKnowledge, searchPrompts, searchOKKBlocks } from '../lib/kb-search';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function testSearch() {
    console.log('--- Testing Product Search (Semantic) ---');
    // Searching for "сушилка" should find "Шкаф сушильный"
    const products = await searchProductKnowledge('сушилка для сада', 3, 0.1);
    console.log('Products found:', products.map(p => ({ name: p.name, similarity: p.similarity })));

    console.log('\n--- Testing System Prompts Search ---');
    const prompts = await searchPrompts('анализ заказов', 'system_prompts', 1);
    console.log('Prompts found:', prompts.map(p => ({ key: p.key, similarity: p.similarity })));

    console.log('\n--- Testing OKK Blocks Search ---');
    const blocks = await searchOKKBlocks('проверка длительности звонка', 1);
    console.log('Blocks found:', blocks.map(b => ({ name: b.name, similarity: b.similarity })));
}

testSearch().then(() => console.log('\nVerification complete.'));
