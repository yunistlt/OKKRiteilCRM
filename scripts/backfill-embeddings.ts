import postgres from 'postgres';
import * as dotenv from 'dotenv';
import { generateEmbedding, formatProductForEmbedding, formatPromptForEmbedding } from '../lib/embeddings';

dotenv.config({ path: '.env.local' });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    console.error('DATABASE_URL is missing');
    process.exit(1);
}

const sql = postgres(databaseUrl, { ssl: 'require' });

async function backfillProducts() {
    console.log('--- Backfilling Product Knowledge ---');
    const products = await sql`SELECT id, name, category, description, use_cases, solved_tasks, pain_points FROM product_knowledge WHERE embedding IS NULL`;
    console.log(`Found ${products.length} products to process`);

    for (const p of products) {
        try {
            console.log(`Processing product: ${p.name}`);
            const text = formatProductForEmbedding(p as any);
            const embedding = await generateEmbedding(text);
            const embeddingString = `[${embedding.join(',')}]`;
            await sql`UPDATE product_knowledge SET embedding = ${embeddingString} WHERE id = ${p.id}`;
        } catch (e) {
            console.error(`Failed to process product ${p.name}:`, e);
        }
    }
}

async function backfillSystemPrompts() {
    console.log('--- Backfilling System Prompts ---');
    const prompts = await sql`SELECT key, content, description FROM system_prompts WHERE embedding IS NULL`;
    console.log(`Found ${prompts.length} system prompts to process`);

    for (const p of prompts) {
        try {
            console.log(`Processing prompt: ${p.key}`);
            const text = formatPromptForEmbedding({ key: p.key, content: p.content, description: p.description });
            const embedding = await generateEmbedding(text);
            const embeddingString = `[${embedding.join(',')}]`;
            await sql`UPDATE system_prompts SET embedding = ${embeddingString} WHERE key = ${p.key}`;
        } catch (e) {
            console.error(`Failed to process system prompt ${p.key}:`, e);
        }
    }
}

async function backfillAIPrompts() {
    console.log('--- Backfilling AI Prompts ---');
    const prompts = await sql`SELECT id, key, system_prompt as content, description FROM ai_prompts WHERE embedding IS NULL`;
    console.log(`Found ${prompts.length} AI prompts to process`);

    for (const p of prompts) {
        try {
            console.log(`Processing AI prompt: ${p.key}`);
            const text = formatPromptForEmbedding({ key: p.key, content: p.content, description: p.description });
            const embedding = await generateEmbedding(text);
            const embeddingString = `[${embedding.join(',')}]`;
            await sql`UPDATE ai_prompts SET embedding = ${embeddingString} WHERE id = ${p.id}`;
        } catch (e) {
            console.error(`Failed to process AI prompt ${p.key}:`, e);
        }
    }
}

async function backfillBlockDefinitions() {
    console.log('--- Backfilling Block Definitions ---');
    const blocks = await sql`SELECT id, code, name, description, ai_prompt as content FROM okk_block_definitions WHERE embedding IS NULL`;
    console.log(`Found ${blocks.length} blocks to process`);

    for (const b of blocks) {
        try {
            console.log(`Processing block: ${b.code}`);
            const text = formatPromptForEmbedding({ key: b.code, name: b.name, content: b.content, description: b.description });
            const embedding = await generateEmbedding(text);
            const embeddingString = `[${embedding.join(',')}]`;
            await sql`UPDATE okk_block_definitions SET embedding = ${embeddingString} WHERE id = ${b.id}`;
        } catch (e) {
            console.error(`Failed to process block ${b.code}:`, e);
        }
    }
}

async function main() {
    try {
        await backfillProducts();
        await backfillSystemPrompts();
        await backfillAIPrompts();
        await backfillBlockDefinitions();
        console.log('Done!');
    } catch (e) {
        console.error('Backfill failed:', e);
    } finally {
        await sql.end();
    }
}

main();
