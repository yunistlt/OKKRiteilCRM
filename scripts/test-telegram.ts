
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function sendTest() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    console.log(`Sending to Chat ID: ${chatId}`);

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = {
        chat_id: chatId,
        text: '👋 <b>System Auditor Connected!</b>\n\nI will check the system every 4 hours and alert you if anything looks wrong.\n\nCurrent Status: 🟢 <b>Monitoring Active</b>',
        parse_mode: 'HTML'
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log('Result:', data);
}

sendTest();
