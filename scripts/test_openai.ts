import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function testOpenAI() {
    const apiKey = process.env.OPENAI_API_KEY;
    console.log('Key loaded:', apiKey ? `${apiKey.substring(0, 20)}...` : 'MISSING');

    if (!apiKey) {
        console.error('❌ OPENAI_API_KEY not found in .env.local');
        return;
    }

    const openai = new OpenAI({ apiKey });

    try {
        console.log('Sending test request to OpenAI...');
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'Say "test OK"' }],
            max_tokens: 10
        });

        console.log('✅ Success!');
        console.log('Response:', response.choices[0].message.content);
    } catch (error: any) {
        console.error('❌ OpenAI Error:');
        console.error('Status:', error.status);
        console.error('Type:', error.type);
        console.error('Code:', error.code);
        console.error('Message:', error.message);

        if (error.response) {
            console.error('Full error:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

testOpenAI();
