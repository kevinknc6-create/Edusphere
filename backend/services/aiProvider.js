async function askGemini(messages) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("AI_NOT_CONFIGURED");
    const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    const systemInstruction = messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
    const contents = messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
        }));
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
            ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
            contents,
            generationConfig: { temperature: 0.3 },
        }),
        signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`AI_PROVIDER_FAILED_${response.status}`);
    const payload = await response.json();
    const answer = payload.candidates?.[0]?.content?.parts
        ?.map((part) => typeof part.text === "string" ? part.text : "")
        .join("")
        .trim();
    if (!answer) throw new Error("AI_EMPTY_RESPONSE");
    return answer;
}

async function askOpenAi(messages) {
    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
    if (!apiKey) throw new Error("AI_NOT_CONFIGURED");
    const response = await fetch(process.env.AI_API_URL || "https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-4o-mini", messages }),
        signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`AI_PROVIDER_FAILED_${response.status}`);
    const payload = await response.json();
    const answer = payload.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) throw new Error("AI_EMPTY_RESPONSE");
    return answer.trim();
}

async function askProvider(messages) {
    const provider = (process.env.AI_PROVIDER || "openai").toLowerCase();
    if (provider === "gemini" || provider === "google") return askGemini(messages);
    if (provider === "openai") return askOpenAi(messages);
    throw new Error("AI_PROVIDER_NOT_SUPPORTED");
}

module.exports = { askProvider };
