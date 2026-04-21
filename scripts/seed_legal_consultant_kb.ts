import * as dotenv from 'dotenv';
import postgres from 'postgres';
import { formatConsultantKnowledgeForEmbedding, generateEmbedding } from '../lib/embeddings';
import { buildLegalKnowledgeSeedRows, getLegalKnowledgeVersion } from '../lib/legal-consultant-kb';
import { DEFAULT_LEGAL_PROMPTS } from '../lib/legal-consultant-ai';

dotenv.config({ path: '.env.local' });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    console.error('DATABASE_URL is missing');
    process.exit(1);
}

const sql = postgres(databaseUrl, { ssl: 'require' });

async function ensurePrompts() {
    for (const prompt of Object.values(DEFAULT_LEGAL_PROMPTS)) {
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
                ${prompt.key},
                ${`Legal consultant prompt: ${prompt.key}`},
                ${prompt.systemPrompt},
                ${prompt.userPromptTemplate},
                ${prompt.model},
                ${prompt.temperature},
                ${prompt.maxTokens},
                ${JSON.stringify(prompt.metadata || {})}::jsonb,
                true,
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
    const version = getLegalKnowledgeVersion();
    const rows = buildLegalKnowledgeSeedRows();

    console.log(`Seeding ${rows.length} legal KB rows (version ${version})`);

    for (const row of rows) {
        const embedding = await generateEmbedding(formatConsultantKnowledgeForEmbedding(row));
        const embeddingString = `[${embedding.join(',')}]`;

        await sql`
            INSERT INTO legal_consultant_knowledge (
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
                ${version},
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
    }
}

async function main() {
    try {
        await ensurePrompts();
        await seedKnowledgeBase();
        console.log('Legal consultant KB seeding finished');
    } catch (error) {
        console.error('Legal consultant KB seeding failed:', error);
        process.exitCode = 1;
    } finally {
        await sql.end();
    }
}

void main();