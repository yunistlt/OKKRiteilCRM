import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const client = new Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
await client.connect();
const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '20260903_templates.sql'), 'utf8');
await client.query(sql);
console.log('Миграция шаблонов применена');
await client.end();
