function isSenderBlocked(fromEmail, blocklist) {
  if (!fromEmail || !blocklist?.length) return false;
  const email = fromEmail.trim().toLowerCase();
  const domain = email.split('@')[1] || '';
  for (const raw of blocklist) {
    const entry = String(raw).trim().toLowerCase().replace(/^@/, '');
    if (!entry) continue;
    if (entry.includes('@')) { if (email === entry) return true; }
    else if (domain && (domain === entry || domain.endsWith('.' + entry))) return true;
  }
  return false;
}
const list = ['dmto@pharmperspectiva.ru', 'example-tenders.ru'];
const cases = [
  ['dmto@pharmperspectiva.ru', true],   // точный адрес
  ['DMTO@Pharmperspectiva.RU', true],   // регистр
  ['zapros_kp@pharmperspectiva.ru', false], // другой адрес того же домена (только точный в списке)
  ['a@example-tenders.ru', true],       // домен
  ['a@sub.example-tenders.ru', true],   // поддомен
  ['a@example-tenders.ru.evil.com', false], // не поддомен
  ['vodnevaiv@gazpromgr.tomsk.ru', false],  // обычный клиент
  [null, false],
];
let ok = 0;
for (const [email, exp] of cases) {
  const got = isSenderBlocked(email, list);
  console.log(`${got===exp?'OK ':'FAIL'} ${String(email)} -> ${got} (ждали ${exp})`);
  if (got===exp) ok++;
}
console.log(`\n${ok}/${cases.length}`);
