import axios from 'axios';

const telphinClient = axios.create({
  baseURL: process.env.TELPHIN_API_URL,
  headers: {
    'X-API-Key': process.env.TELPHIN_API_KEY,
    'Content-Type': 'application/json',
  },
});

export async function setupTelphinWebhooks() {
  try {
    // Регистрируем webhooks в Telphin
    const webhooks = [
      {
        event: 'call.incoming',
        url: `${process.env.BASE_URL}/api/calls/webhooks/incoming`,
      },
      {
        event: 'call.status_update',
        url: `${process.env.BASE_URL}/api/calls/webhooks/status-update`,
      },
      {
        event: 'call.recording_ready',
        url: `${process.env.BASE_URL}/api/calls/webhooks/recording`,
      },
    ];

    for (const webhook of webhooks) {
      await telphinClient.post('/webhooks/register', webhook);
      console.log(`✅ Webhook registered: ${webhook.event}`);
    }
  } catch (error) {
    console.error('Failed to setup Telphin webhooks:', error);
  }
}

export default telphinClient;
