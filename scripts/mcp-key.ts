/**
 * Ключи коннектора Claude: выдать, показать, отозвать.
 *
 *   npx tsx --env-file=.env.local scripts/mcp-key.ts issue "Имя Фамилия" [почта учётки]
 *   npx tsx --env-file=.env.local scripts/mcp-key.ts list
 *   npx tsx --env-file=.env.local scripts/mcp-key.ts revoke <номер ключа>
 *
 * Ключ печатается один раз, при выдаче: в базе остаётся только его хеш.
 */
import { supabase } from '../utils/supabase';
import { generateKey, hashKey } from '../lib/mcp/keys';

async function employeeIdByEmail(email: string): Promise<string | null> {
    for (const table of ['profiles', 'users']) {
        const { data } = await supabase.from(table).select('id').ilike('email', email).maybeSingle();
        if (data?.id) return String(data.id);
    }
    return null;
}

async function issue(name: string, email?: string) {
    if (!name) throw new Error('Укажи имя сотрудника: issue "Имя Фамилия" [почта]');

    let employeeId: string | null = null;
    if (email) {
        employeeId = await employeeIdByEmail(email);
        if (!employeeId) throw new Error(`Учётки с почтой ${email} в ОКК нет — ключ не выдан.`);
    }

    const key = generateKey();
    const { data, error } = await supabase
        .from('mcp_keys')
        .insert({ employee_id: employeeId, employee_name: name, key_hash: hashKey(key), key_hint: key.slice(-4), created_by: 'scripts/mcp-key.ts' })
        .select('id')
        .single();
    if (error) throw new Error(error.message);

    console.log(`Ключ №${data.id} выдан: ${name}`);
    console.log('');
    console.log(`  ${key}`);
    console.log('');
    console.log('Сохрани его сейчас — второй раз он не показывается.');
    console.log('Подключение в Claude: адрес https://okk.zmksoft.com/mcp/okk, заголовок X-Api-Key = ключ.');
}

async function list() {
    const { data, error } = await supabase
        .from('mcp_keys')
        .select('id, employee_name, key_hint, closed_sections, created_at, last_used_at, revoked_at')
        .order('id');
    if (error) throw new Error(error.message);
    for (const k of data ?? []) {
        const state = k.revoked_at ? `отозван ${String(k.revoked_at).slice(0, 10)}` : 'действует';
        const used = k.last_used_at ? String(k.last_used_at).slice(0, 16).replace('T', ' ') : 'не использовался';
        console.log(`№${k.id}  …${k.key_hint}  ${k.employee_name}  —  ${state}; выдан ${String(k.created_at).slice(0, 10)}; последний вызов: ${used}`);
    }
    if (!data?.length) console.log('Ключей нет.');
}

async function revoke(id: string) {
    if (!/^\d+$/.test(id ?? '')) throw new Error('Укажи номер ключа: revoke <номер>');
    const { data, error } = await supabase
        .from('mcp_keys')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', Number(id))
        .is('revoked_at', null)
        .select('id, employee_name');
    if (error) throw new Error(error.message);
    console.log(data?.length ? `Ключ №${id} (${data[0].employee_name}) отозван.` : `Действующего ключа №${id} нет.`);
}

async function main() {
    const [command, a, b] = process.argv.slice(2);
    if (command === 'issue') return issue(a, b);
    if (command === 'list') return list();
    if (command === 'revoke') return revoke(a);
    console.log('Команды: issue "Имя Фамилия" [почта] | list | revoke <номер>');
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
