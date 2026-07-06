import postgres from 'postgres';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g,'');
const sql = postgres(url, { ssl: 'require' });

const since = "now() - interval '7 days'";
console.log('=== Распределение по маршрутам за 7 дней (classified_by=ai) ===');
const dist = await sql.unsafe(`
  SELECT email_type, count(*) n,
         round(avg(confidence)::numeric,2) avg_conf,
         sum((status='processed')::int) processed,
         sum((status='needs_review')::int) needs_review,
         sum((status='error')::int) errors
  FROM incoming_emails
  WHERE received_at >= ${since} AND email_type IS NOT NULL
  GROUP BY email_type ORDER BY n DESC`);
console.table(dist);

console.log('\n=== Кандидаты на ошибку: низкая уверенность (<0.6), отделы + new_request ===');
const low = await sql.unsafe(`
  SELECT id, email_type, confidence, from_email, left(subject,60) subj, left(reasoning,90) why
  FROM incoming_emails
  WHERE received_at >= ${since}
    AND email_type IN ('accounting','logistics','legal','procurement','new_request')
    AND coalesce(confidence,0) < 0.6
  ORDER BY received_at DESC LIMIT 40`);
console.table(low);

await sql.end();
