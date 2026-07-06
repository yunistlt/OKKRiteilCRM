require('dotenv').config({ path: '.env.local' });
const { ImapFlow } = require('imapflow');
(async () => {
  const user = process.env.IMAP_USER || process.env.SMTP_USER;
  const pass = process.env.IMAP_PASS || process.env.SMTP_PASS;
  const host = process.env.IMAP_HOST || 'imap.yandex.ru';
  const port = Number(process.env.IMAP_PORT || 993);
  console.log('host', host, 'port', port, 'user', user);
  const c = new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false });
  try {
    await c.connect();
    console.log('connected OK');
    const lock = await c.getMailboxLock('INBOX', { readOnly: true });
    console.log('mailbox exists:', c.mailbox && c.mailbox.exists, 'uidNext:', c.mailbox && c.mailbox.uidNext);
    lock.release();
    await c.logout();
  } catch (e) {
    console.error('ERR message:', e && e.message);
    console.error('ERR code:', e && e.code);
    console.error('ERR responseText:', e && e.responseText);
    console.error('ERR authenticationFailed:', e && e.authenticationFailed);
  }
})();
