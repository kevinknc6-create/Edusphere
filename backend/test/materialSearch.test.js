const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMaterialSearchQuery } = require("../services/materialSearch");

test("builds a normalized OR query from question terms", () => {
    assert.equal(buildMaterialSearchQuery("Explain photosynthesis and chlorophyll"), "'explain' | 'photosynthesis' | 'chlorophyll'");
});

test("deduplicates and caps search terms", () => {
    assert.equal(
        buildMaterialSearchQuery("Math math science biology geography agriculture physics chemistry history english French"),
        "'math' | 'science' | 'biology' | 'geography' | 'agriculture' | 'physics' | 'chemistry' | 'history' | 'english' | 'french'",
    );
});

test("returns no query for greetings and filler phrases", () => {
    assert.equal(buildMaterialSearchQuery("Hi!"), null);
    assert.equal(buildMaterialSearchQuery("Hello, can you help me?"), null);
});

test("ignores PostgreSQL tsquery operators and punctuation in questions", () => {
    assert.equal(buildMaterialSearchQuery("lesson' | !:* AND science"), "'lesson' | 'science'");
});
