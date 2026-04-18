import * as dotenv from 'dotenv';
import postgres from 'postgres';
import { formatConsultantKnowledgeForEmbedding, generateEmbedding } from '../lib/embeddings';
import { buildConsultantKnowledgeSeedRows, type ConsultantKnowledgeSeedRow } from '../lib/okk-consultant-kb';
import { DEFAULT_CONSULTANT_PROMPTS } from '../lib/okk-consultant-ai';

dotenv.config({ path: '.env.local' });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    console.error('DATABASE_URL is missing');
    process.exit(1);
}

const sql = postgres(databaseUrl, { ssl: 'require' });

async function ensureConsultantPrompts() {
    const rows = Object.values(DEFAULT_CONSULTANT_PROMPTS).map((prompt) => ({
        key: prompt.key,
        description: `OKK consultant prompt: ${prompt.key}`,
        system_prompt: prompt.systemPrompt,
        user_prompt_template: prompt.userPromptTemplate,
        model: prompt.model,
        temperature: prompt.temperature,
        max_tokens: prompt.maxTokens,
        metadata: JSON.stringify(prompt.metadata || {}),
        is_active: true,
    }));

    for (const row of rows) {
        console.log(`Ensuring prompt ${row.key}`);
        await sql`
            INSERT INTO ai_prompts (
                key,
                description,
                system_prompt,
                user_prompt_template,
                model,
                temperature,
                max_tokens,
                metadata,
                is_active,
                updated_at
            )
            VALUES (
                ${row.key},
                ${row.description},
                ${row.system_prompt},
                ${row.user_prompt_template},
                ${row.model},
                ${row.temperature},
                ${row.max_tokens},
                ${row.metadata}::jsonb,
                ${row.is_active},
                NOW()
            )
            ON CONFLICT (key) DO UPDATE SET
                description = EXCLUDED.description,
                system_prompt = EXCLUDED.system_prompt,
                user_prompt_template = EXCLUDED.user_prompt_template,
                model = EXCLUDED.model,
                temperature = EXCLUDED.temperature,
                max_tokens = EXCLUDED.max_tokens,
                metadata = EXCLUDED.metadata,
                updated_at = NOW()
        `;
    }
}

async function seedKnowledgeBase() {
    const rows: ConsultantKnowledgeSeedRow[] = buildConsultantKnowledgeSeedRows();
    console.log(`Seeding ${rows.length} consultant KB rows`);

    for (const row of rows) {
        try {
            const embedding = await generateEmbedding(formatConsultantKnowledgeForEmbedding(row));
            const embeddingString = `[${embedding.join(',')}]`;

            await sql`
                INSERT INTO okk_consultant_knowledge (
                    slug,
                    type,
                    section_key,
                    title,
                    content,
                    tags,
                    source_ref,
                    metadata,
                    is_active,
                    version,
                    embedding,
                    updated_at
                )
                VALUES (
                    ${row.slug},
                    ${row.type},
                    ${row.sectionKey},
                    ${row.title},
                    ${row.content},
                    ${row.tags},
                    ${row.sourceRef},
                    ${JSON.stringify(row.metadata || {})}::jsonb,
                    true,
                    1,
                    ${embeddingString},
                    NOW()
                )
                ON CONFLICT (slug) DO UPDATE SET
                    type = EXCLUDED.type,
                    section_key = EXCLUDED.section_key,
                    title = EXCLUDED.title,
                    content = EXCLUDED.content,
                    tags = EXCLUDED.tags,
                    source_ref = EXCLUDED.source_ref,
                    metadata = EXCLUDED.metadata,
                    is_active = EXCLUDED.is_active,
                    version = EXCLUDED.version,
                    embedding = EXCLUDED.embedding,
                    updated_at = NOW()
            `;

            console.log(`Seeded ${row.slug}`);
        } catch (error) {
            console.error(`Failed to seed ${row.slug}:`, error);
        }
    }
}

async function main() {
    try {
        await ensureConsultantPrompts();
        await seedKnowledgeBase();
        console.log('OKK consultant KB seeding finished');
    } catch (error) {
        console.error('Consultant KB seeding failed:', error);
        process.exitCode = 1;
    } finally {
        await sql.end();
    }
}

void main();