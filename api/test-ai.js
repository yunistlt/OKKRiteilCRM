// api/test-ai.js

export default async function handler(req, res) {
  const key = process.env.OPENAI_API_KEY;

  if (!key) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is missing' });
  }

  try {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: "ping" }],
      }),
    });

    const data = await aiRes.json();
    res.status(200).json({ ok: true, openai_response: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}