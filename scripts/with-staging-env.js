/**
 * Запустить что угодно против ТЕСТОВОЙ базы, а не боевой.
 *
 * Берёт из .env.local переменные `STAGING_*` и подставляет их на место боевых
 * (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, ключи). Так один и тот же код
 * работает со стендом без правки файлов и без риска попасть в прод.
 *
 * Запуск:
 *   node scripts/with-staging-env.js next dev -p 3051
 *   node scripts/with-staging-env.js npx tsx scripts/<любой>.ts
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const file = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const env = Object.fromEntries(
    file.split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    }),
);

const required = ['STAGING_DATABASE_URL', 'STAGING_SUPABASE_URL', 'STAGING_SUPABASE_ANON_KEY', 'STAGING_SUPABASE_SERVICE_ROLE_KEY'];
const missing = required.filter((key) => !env[key]);
if (missing.length) {
    console.error('В .env.local нет доступов стенда:', missing.join(', '));
    process.exit(1);
}

const overrides = {
    ...env,
    DATABASE_URL: env.STAGING_DATABASE_URL,
    POSTGRES_URL: env.STAGING_DATABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: env.STAGING_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.STAGING_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
    // Видно в интерфейсе и в логах: это стенд, а не прод.
    NEXT_PUBLIC_ENV_LABEL: 'СТЕНД',
};

const [command, ...args] = process.argv.slice(2);
if (!command) {
    console.error('Нечего запускать: node scripts/with-staging-env.js <команда>');
    process.exit(1);
}

console.log('→ стенд:', env.STAGING_SUPABASE_URL);
const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...overrides } });
child.on('exit', (code) => process.exit(code ?? 0));
