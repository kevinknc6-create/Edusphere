const test = require("node:test");
const assert = require("node:assert/strict");
const { askProvider } = require("../services/aiProvider");

function withEnvironment(values, callback) {
    const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    return Promise.resolve()
        .then(callback)
        .finally(() => {
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        });
}

test("sends Gemini requests to the configured model with server-side key and system instructions", async () => {
    const originalFetch = global.fetch;
    let request;
    global.fetch = async (url, options) => {
        request = { url: String(url), options };
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "  Muraho neza. " }] } }] }) };
    };
    try {
        const answer = await withEnvironment({
            AI_PROVIDER: "gemini",
            GEMINI_API_KEY: "test-gemini-secret",
            GEMINI_MODEL: "gemini-3.5-flash-lite",
        }, () => askProvider([
            { role: "system", content: "Be helpful." },
            { role: "user", content: "Muraho" },
        ]));
        assert.equal(answer, "Muraho neza.");
        assert.equal(request.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
        assert.equal(request.options.headers["x-goog-api-key"], "test-gemini-secret");
        assert.equal(request.url.includes("test-gemini-secret"), false);
        const body = JSON.parse(request.options.body);
        assert.equal(body.systemInstruction.parts[0].text, "Be helpful.");
        assert.deepEqual(body.contents, [{ role: "user", parts: [{ text: "Muraho" }] }]);
    } finally {
        global.fetch = originalFetch;
    }
});

test("reports provider HTTP errors without requiring provider response details", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 429 });
    try {
        await withEnvironment({
            AI_PROVIDER: "gemini",
            GEMINI_API_KEY: "test-gemini-secret",
            GEMINI_MODEL: "gemini-3.5-flash-lite",
        }, async () => {
            await assert.rejects(askProvider([{ role: "user", content: "Hi" }]), /AI_PROVIDER_FAILED_429/);
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test("does not fall back to OpenAI when Gemini is selected without a Gemini key", async () => {
    await withEnvironment({
        AI_PROVIDER: "gemini",
        GEMINI_API_KEY: undefined,
        OPENAI_API_KEY: "test-openai-secret",
    }, async () => {
        await assert.rejects(askProvider([{ role: "user", content: "Hi" }]), /AI_NOT_CONFIGURED/);
    });
});
