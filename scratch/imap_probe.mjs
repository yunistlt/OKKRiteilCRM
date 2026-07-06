// Read-only IMAP probe for Yandex 360 mailbox.
// Uses EXAMINE (read-only select) + BODY.PEEK so it CANNOT change \Seen flags.
// Credentials are read from .env.local (SMTP_USER / SMTP_PASS) — same app password works for IMAP.
// Run: node scratch/imap_probe.mjs
import tls from 'node:tls';
import fs from 'node:fs';

// --- load creds from .env.local ---
const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const USER = process.env.IMAP_USER || env.IMAP_USER || env.SMTP_USER;
const PASS = process.env.IMAP_PASS || env.IMAP_PASS || env.SMTP_PASS;
if (!USER || !PASS) { console.error('No creds (SMTP_USER/SMTP_PASS)'); process.exit(1); }
console.log(`Connecting to imap.yandex.ru:993 as ${USER} ...`);

const sock = tls.connect({ host: 'imap.yandex.ru', port: 993, servername: 'imap.yandex.ru' });
let buf = '';
let resolveTag = null;
let waitTag = null;

sock.setEncoding('utf8');
sock.on('data', (d) => {
  buf += d;
  if (waitTag) {
    // command completion line: "<tag> OK|NO|BAD ..."
    const re = new RegExp(`^${waitTag} (OK|NO|BAD)`, 'm');
    const mm = buf.match(re);
    if (mm) {
      const out = buf; buf = '';
      const r = resolveTag; waitTag = null; resolveTag = null;
      r({ status: mm[1], text: out });
    }
  }
});

let n = 0;
function cmd(command, hideLog = false) {
  const tag = 'A' + (++n);
  return new Promise((resolve, reject) => {
    waitTag = tag; resolveTag = resolve;
    if (!hideLog) console.log('>>', command);
    sock.write(`${tag} ${command}\r\n`);
    setTimeout(() => reject(new Error('timeout: ' + command)), 15000);
  });
}

sock.once('secureConnect', async () => {
  try {
    // server greeting arrives first; small delay
    await new Promise(r => setTimeout(r, 300)); buf = '';

    let res = await cmd(`LOGIN "${USER}" "${PASS}"`, true);
    console.log('LOGIN:', res.status);
    if (res.status !== 'OK') { console.error(res.text); sock.end(); process.exit(2); }

    // EXAMINE = read-only open. Will NOT set \Seen on fetch.
    res = await cmd('EXAMINE INBOX');
    const exists = (res.text.match(/\* (\d+) EXISTS/) || [])[1];
    const uidnext = (res.text.match(/UIDNEXT (\d+)/) || [])[1];
    console.log(`\nINBOX: ${exists} messages, UIDNEXT=${uidnext}`);

    const total = parseInt(exists || '0', 10);
    if (total > 0) {
      const from = Math.max(1, total - 4); // last 5
      res = await cmd(`FETCH ${from}:${total} (FLAGS BODY.PEEK[HEADER.FIELDS (DATE FROM SUBJECT MESSAGE-ID)])`);
      console.log('\n--- last messages (read-only, flags untouched) ---');
      // crude split per message block
      const blocks = res.text.split(/\* \d+ FETCH/).slice(1);
      for (const b of blocks) {
        const subj = (b.match(/Subject:\s*(.*)/i) || [])[1]?.trim();
        const fr = (b.match(/From:\s*(.*)/i) || [])[1]?.trim();
        const dt = (b.match(/Date:\s*(.*)/i) || [])[1]?.trim();
        const flags = (b.match(/FLAGS \(([^)]*)\)/) || [])[1];
        console.log(`\n  Date:    ${dt}`);
        console.log(`  From:    ${fr}`);
        console.log(`  Subject: ${subj}`);
        console.log(`  Flags:   (${flags ?? ''})`);
      }
    }
    await cmd('LOGOUT');
    sock.end();
    console.log('\nOK: read-only probe finished, no flags modified.');
  } catch (e) {
    console.error('ERROR:', e.message);
    sock.end(); process.exit(3);
  }
});
sock.on('error', (e) => { console.error('SOCKET ERROR:', e.message); process.exit(4); });
