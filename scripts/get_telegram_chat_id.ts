
const TELEGRAM_BOT_TOKEN = '8211856195:AAHfq8ayrcg7Xm7thHPbNl6G9wRkB1yX_n4';

async function getUpdates() {
    try {
        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`);
        const data = await response.json();

        if (!data.ok) {
            console.error('Error fetching updates:', data);
            return;
        }

        console.log('Updates received:', data.result.length);

        if (data.result.length === 0) {
            console.log('No updates found. Please add the bot to the group and send a message.');
            return;
        }

        data.result.forEach((update: any) => {
            if (update.message && update.message.chat) {
                console.log(`Chat: ${update.message.chat.title || 'Private'} (ID: ${update.message.chat.id})`);
                console.log(`User: ${update.message.from.first_name} (ID: ${update.message.from.id})`);
                console.log('---');
            }
        });

    } catch (error) {
        console.error('Failed to fetch updates:', error);
    }
}

getUpdates();
