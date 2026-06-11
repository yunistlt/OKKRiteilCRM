import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import postgres from 'postgres';
import { generateEmbedding } from '../lib/embeddings';
import { formatProjectKnowledgeForEmbedding, type ProjectAudience } from '../lib/project-knowledge';

dotenv.config({ path: '.env.local' });

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!databaseUrl) {
    console.error('DATABASE_URL is missing');
    process.exit(1);
}

const sql = postgres(databaseUrl, { ssl: 'require' });

const REPO_ROOT = path.resolve(__dirname, '..');
const MAX_CHUNK_CHARS = 1800;

// Where to look for markdown docs (relative to repo root).
const DOC_ROOTS = ['docs', 'lib/retailcrm'];
const DOC_FILES = ['CLAUDE.md'];
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.next', 'scratch', '.agent']);

// Internal/technical docs → audience 'staff' (hidden from managers/demo). Default is 'all'.
const STAFF_PATTERNS: RegExp[] = [
    /^docs\/ARCHITECTURE\.md$/i,
    /^docs\/realtime-pipeline\//i,
    /^CLAUDE\.md$/i,
    /(RELEASE|RUNBOOK)/i,
];

type DocChunk = {
    slug: string;
    sourcePath: string;
    subsystem: string;
    heading: string;
    title: string;
    content: string;
    audience: ProjectAudience;
    tags: string[];
    contentHash: string;
};

function collectMarkdownFiles(): string[] {
    const files: string[] = [];

    const walk = (absDir: string) => {
        for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                if (EXCLUDED_DIRS.has(entry.name)) continue;
                walk(path.join(absDir, entry.name));
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
                files.push(path.join(absDir, entry.name));
            }
        }
    };

    for (const root of DOC_ROOTS) {
        const absRoot = path.join(REPO_ROOT, root);
        if (fs.existsSync(absRoot)) walk(absRoot);
    }
    for (const file of DOC_FILES) {
        const abs = path.join(REPO_ROOT, file);
        if (fs.existsSync(abs)) files.push(abs);
    }

    return files;
}

function parseFrontmatter(raw: string): { body: string; audience?: ProjectAudience } {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return { body: raw };

    const body = raw.slice(match[0].length);
    const audienceMatch = match[1].match(/^audience:\s*(all|staff)\s*$/im);
    return { body, audience: audienceMatch ? (audienceMatch[1].toLowerCase() as ProjectAudience) : undefined };
}

function subsystemFromPath(relPath: string): string {
    if (relPath.startsWith('docs/')) {
        const rest = relPath.slice('docs/'.length);
        const parts = rest.split('/');
        return parts.length > 1 ? parts[0] : 'root';
    }
    if (relPath.startsWith('lib/retailcrm/')) return 'retailcrm';
    return 'root';
}

function resolveAudience(relPath: string, override?: ProjectAudience): ProjectAudience {
    if (override) return override;
    return STAFF_PATTERNS.some((pattern) => pattern.test(relPath)) ? 'staff' : 'all';
}

function splitLargeBody(body: string): string[] {
    if (body.length <= MAX_CHUNK_CHARS) return [body];

    const paragraphs = body.split(/\n{2,}/);
    const parts: string[] = [];
    let current = '';

    for (const paragraph of paragraphs) {
        if (current && (current.length + paragraph.length + 2) > MAX_CHUNK_CHARS) {
            parts.push(current.trim());
            current = '';
        }
        current += (current ? '\n\n' : '') + paragraph;
    }
    if (current.trim()) parts.push(current.trim());

    return parts.length ? parts : [body];
}

function chunkMarkdown(relPath: string, raw: string): DocChunk[] {
    const { body, audience: fmAudience } = parseFrontmatter(raw);
    const subsystem = subsystemFromPath(relPath);
    const audience = resolveAudience(relPath, fmAudience);
    const fileTitle = path.basename(relPath);

    const lines = body.split('\n');
    const headingStack: Array<{ level: number; text: string }> = [];
    type Section = { breadcrumb: string; title: string; lines: string[] };
    const sections: Section[] = [];
    let currentLines: string[] = [];

    const flush = () => {
        const text = currentLines.join('\n').trim();
        if (text) {
            const breadcrumb = headingStack.map((h) => h.text).join(' > ') || fileTitle;
            const title = headingStack[headingStack.length - 1]?.text || fileTitle;
            sections.push({ breadcrumb, title, lines: [text] });
        }
        currentLines = [];
    };

    for (const line of lines) {
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch && headingMatch[1].length <= 3) {
            flush();
            const level = headingMatch[1].length;
            while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
                headingStack.pop();
            }
            headingStack.push({ level, text: headingMatch[2].replace(/[#*`]/g, '').trim() });
        } else {
            currentLines.push(line);
        }
    }
    flush();

    const chunks: DocChunk[] = [];
    let headingIndex = 0;

    for (const section of sections) {
        const rawBody = section.lines.join('\n').trim();
        if (!rawBody) {
            headingIndex += 1;
            continue;
        }

        const parts = splitLargeBody(rawBody);
        parts.forEach((part, subIdx) => {
            const slug = parts.length > 1
                ? `doc:${relPath}#h${headingIndex}-${subIdx}`
                : `doc:${relPath}#h${headingIndex}`;
            const content = `${section.breadcrumb}\n\n${part}`.trim();
            chunks.push({
                slug,
                sourcePath: relPath,
                subsystem,
                heading: section.breadcrumb,
                title: section.title,
                content,
                audience,
                tags: [subsystem, fileTitle].filter(Boolean),
                contentHash: crypto.createHash('sha256').update(content).digest('hex'),
            });
        });
        headingIndex += 1;
    }

    return chunks;
}

async function seed() {
    const files = collectMarkdownFiles();
    console.log(`Found ${files.length} markdown files`);

    const allChunks: DocChunk[] = [];
    for (const abs of files) {
        const relPath = path.relative(REPO_ROOT, abs).split(path.sep).join('/');
        const raw = fs.readFileSync(abs, 'utf8');
        allChunks.push(...chunkMarkdown(relPath, raw));
    }
    console.log(`Built ${allChunks.length} chunks`);

    const existing = await sql<Array<{ slug: string; content_hash: string | null }>>`
        SELECT slug, content_hash FROM project_knowledge
    `;
    const hashBySlug = new Map(existing.map((row) => [row.slug, row.content_hash]));

    let embedded = 0;
    let skipped = 0;
    let failed = 0;
    const activeSlugs: string[] = [];

    for (const chunk of allChunks) {
        activeSlugs.push(chunk.slug);

        if (hashBySlug.get(chunk.slug) === chunk.contentHash) {
            // Unchanged — just ensure it's active, no re-embedding.
            await sql`UPDATE project_knowledge SET is_active = true, updated_at = NOW() WHERE slug = ${chunk.slug}`;
            skipped += 1;
            continue;
        }

        try {
            const embedding = await generateEmbedding(formatProjectKnowledgeForEmbedding(chunk));
            const embeddingString = `[${embedding.join(',')}]`;

            await sql`
                INSERT INTO project_knowledge (
                    slug, source_path, subsystem, heading, title, content,
                    audience, tags, metadata, is_active, content_hash, embedding, updated_at
                )
                VALUES (
                    ${chunk.slug}, ${chunk.sourcePath}, ${chunk.subsystem}, ${chunk.heading},
                    ${chunk.title}, ${chunk.content}, ${chunk.audience}, ${chunk.tags},
                    ${JSON.stringify({})}::jsonb, true, ${chunk.contentHash}, ${embeddingString}, NOW()
                )
                ON CONFLICT (slug) DO UPDATE SET
                    source_path = EXCLUDED.source_path,
                    subsystem = EXCLUDED.subsystem,
                    heading = EXCLUDED.heading,
                    title = EXCLUDED.title,
                    content = EXCLUDED.content,
                    audience = EXCLUDED.audience,
                    tags = EXCLUDED.tags,
                    is_active = true,
                    content_hash = EXCLUDED.content_hash,
                    embedding = EXCLUDED.embedding,
                    updated_at = NOW()
            `;
            embedded += 1;
        } catch (error) {
            failed += 1;
            console.error(`Failed to seed ${chunk.slug}:`, error instanceof Error ? error.message : error);
        }
    }

    // Reconcile: deactivate rows whose source chunk no longer exists.
    const activeSet = new Set(activeSlugs);
    const staleSlugs = existing.map((row) => row.slug).filter((slug) => !activeSet.has(slug));
    if (staleSlugs.length) {
        await sql`UPDATE project_knowledge SET is_active = false, updated_at = NOW() WHERE slug = ANY(${staleSlugs})`;
    }

    console.log(`Project KB seeding finished: ${embedded} embedded, ${skipped} unchanged, ${failed} failed, ${staleSlugs.length} deactivated`);

    // Loud failure for manual runs: nothing got embedded although there was work to do
    // (e.g. OpenAI quota exhausted). Surfaces the problem instead of a misleading exit 0.
    if (embedded === 0 && skipped === 0 && allChunks.length > 0) {
        throw new Error(`No chunks were embedded (${failed} failed). Check OPENAI_API_KEY quota/billing.`);
    }
}

async function main() {
    try {
        await seed();
    } catch (error) {
        console.error('Project KB seeding failed:', error);
        process.exitCode = 1;
    } finally {
        await sql.end();
    }
}

void main();
