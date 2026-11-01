const NON_TOPICAL_TERMS = new Set([
    "a", "an", "and", "are", "can", "could", "do", "does", "for", "from",
    "give", "hello", "help", "hey", "hi", "how", "i", "is", "it", "me", "my",
    "please", "tell", "thanks", "thank", "the", "this", "to", "what",
    "with", "would", "you",
]);

function buildMaterialSearchQuery(question) {
    const terms = question.normalize("NFKC").match(/[\p{L}\p{N}]{2,}/gu) || [];
    const uniqueTerms = [...new Set(terms.map((term) => term.toLowerCase())
        .filter((term) => !NON_TOPICAL_TERMS.has(term)))].slice(0, 12);
    if (!uniqueTerms.length) return null;
    return uniqueTerms.map((term) => `'${term.replace(/'/g, "''")}'`).join(" | ");
}

module.exports = { buildMaterialSearchQuery };
