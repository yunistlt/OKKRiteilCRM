import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { generateHumanNotification } from '../lib/semantic';
import { sendTelegramNotification } from '../lib/telegram';

async function test() {
    console.log("Generating message...");
    const msg = await generateHumanNotification(
        "Оля",
        "45818",
        "Контроль смены статуса",
        "Ты перевела в статус Заявка квалифицирована, но при этом не заполнила данные клиента, ни имени ни названия организации.",
        "",
        "anna"
    );
    console.log("Generated Message:\n", msg);
    console.log("Sending to Telegram...");
    await sendTelegramNotification(msg);
    console.log("Done!");
}

test().catch(console.error);
