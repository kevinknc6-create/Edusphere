const test = require("node:test");
const assert = require("node:assert/strict");
const {
    extractReadableContent, fetchPublicResource, splitIntoChunks, storagePath, storePdf, validateResourceUrl,
} = require("../services/learningMaterials");

test("accepts public HTTP and HTTPS URLs only", () => {
    assert.equal(validateResourceUrl("https://example.org/lesson").hostname, "example.org");
    assert.throws(() => validateResourceUrl("file:///etc/passwd"), /HTTP or HTTPS/);
    assert.throws(() => validateResourceUrl("https://user:pass@example.org/"), /without embedded credentials/);
    assert.throws(() => validateResourceUrl("http://example.org:8080/"), /unsupported port/);
});

test("blocks literal private hosts before making a request", async () => {
    await assert.rejects(fetchPublicResource("http://127.0.0.1/secret"), /public hostname/);
    await assert.rejects(fetchPublicResource("http://169.254.169.254/metadata"), /public hostname/);
});

test("extracts readable text from HTML without retaining script content", async () => {
    const html = Buffer.from("<html><script>do not index this</script><main>Mathematics &amp; science learning resource for students</main></html>");
    const result = await extractReadableContent(html, "text/html");
    assert.match(result, /Mathematics & science learning resource/);
    assert.doesNotMatch(result, /do not index this/);
});

test("splits extracted material into overlapping searchable chunks", () => {
    const chunks = splitIntoChunks("a".repeat(3000), 1600, 240);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].length, 1600);
    assert.equal(chunks[1].length, 1600);
    assert.equal(chunks[2].length, 280);
    assert.equal(chunks[0].slice(-240), chunks[1].slice(0, 240));
});

test("storage paths accept only UUID keys and PDF storage checks signatures", async () => {
    assert.throws(() => storagePath("..\\secret"), /Invalid learning material storage key/);
    await assert.rejects(storePdf(Buffer.from("not a pdf document")), /valid PDF/);
});
