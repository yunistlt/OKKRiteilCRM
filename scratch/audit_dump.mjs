import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });
const rows = await sql.unsafe(`
  SELECT id, email_type, confidence, from_email, from_name, subject,
         left(regexp_replace(coalesce(body_text,''),'\\s+',' ','g'),300) body,
         left(reasoning,200) reasoning, status, forwarded_to
  FROM incoming_emails
  WHERE received_at >= now() - interval '7 days' AND email_type IS NOT NULL
  ORDER BY received_at DESC`);
for (const r of rows) {
  console.log(`\n#${r.id} [${r.email_type}] conf=${r.confidence} status=${r.status}`);
  console.log(`  from: ${r.from_name||''} <${r.from_email||''}>`);
  console.log(`  subj: ${r.subject||''}`);
  console.log(`  body: ${r.body||''}`);
  console.log(`  why : ${r.reasoning||''}`);
}
console.log(`\nИТОГО: ${rows.length}`);
await sql.end();
