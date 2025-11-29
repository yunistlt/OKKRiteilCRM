// /api/utils/aiClient.js

export async function askAI({
  prompt,
  model = "gpt-4.1-mini",
  responseFormat = "json_object",
}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing in environment variables");
  }

  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
  };

  // Если мы ждём JSON — укажем это
  if (responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("AI Error:", errorText);
    throw new Error("AI request failed: " + errorText);
  }

  const data = await res.json();

  // Возвращаем чистый текст/JSON из message.content
  return data.choices?.[0]?.message?.content || null;
}