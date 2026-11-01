const crypto = require("node:crypto");
const dns = require("node:dns").promises;
const fs = require("node:fs/promises");
const https = require("node:https");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const pool = require("../db");

const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const STORAGE_ROOT = path.resolve(process.env.EDUSPHERE_MATERIAL_STORAGE_DIR || path.join(__dirname, "..", "storage", "learning-materials"));
const PRIVATE_IPV4_RANGES = [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
    ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
    ["224.0.0.0", 4], ["240.0.0.0", 4],
];

function inIpv4Range(address, network, prefix) {
    const toNumber = (value) => value.split(".").reduce((result, part) => (result * 256) + Number(part), 0) >>> 0;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (toNumber(address) & mask) === (toNumber(network) & mask);
}

function isPublicIpv4(address) {
    return net.isIPv4(address) && !PRIVATE_IPV4_RANGES.some(([network, prefix]) => inIpv4Range(address, network, prefix));
}

async function resolvePublicIpv4(hostname) {
    if (!hostname || hostname.endsWith(".") || hostname === "localhost" || hostname.endsWith(".localhost") || net.isIP(hostname)) {
        throw new Error("The resource URL must use a public hostname.");
    }
    let records;
    try {
        records = await dns.lookup(hostname, { all: true, family: 4, verbatim: true });
    } catch {
        throw new Error("The resource host could not be resolved.");
    }
    if (!records.length || records.some(({ address }) => !isPublicIpv4(address))) {
        throw new Error("The resource host does not resolve exclusively to public addresses.");
    }
    return records[0];
}

function validateResourceUrl(value) {
    let url;
    try { url = new URL(value); }
    catch { throw new Error("Enter a valid public HTTP or HTTPS resource URL."); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw new Error("Use a public HTTP or HTTPS URL without embedded credentials.");
    }
    if ((url.port && !["80", "443"].includes(url.port)) || !url.hostname) {
        throw new Error("The resource URL uses an unsupported port.");
    }
    return url;
}

async function fetchPublicResource(value, redirects = 0) {
    const url = validateResourceUrl(value);
    if (redirects > 4) throw new Error("The resource URL redirected too many times.");
    const resolved = await resolvePublicIpv4(url.hostname);
    const transport = url.protocol === "https:" ? https : http;
    const response = await new Promise((resolve, reject) => {
        const request = transport.get(url, {
            headers: { "User-Agent": "EdusphereLearningMaterials/1.0", Accept: "text/html, text/plain, application/pdf;q=0.9", "Accept-Encoding": "identity" },
            lookup: (_hostname, options, callback) => {
                if (options && options.all) callback(null, [{ address: resolved.address, family: resolved.family }]);
                else callback(null, resolved.address, resolved.family);
            },
            servername: url.hostname,
        }, (result) => {
            if ([301, 302, 303, 307, 308].includes(result.statusCode) && result.headers.location) {
                result.resume();
                resolve({ redirect: new URL(result.headers.location, url).toString() });
                return;
            }
            if (result.statusCode !== 200) {
                result.resume();
                reject(new Error(`The resource server returned HTTP ${result.statusCode || "error"}.`));
                return;
            }
            const length = Number(result.headers["content-length"] || 0);
            if (length > MAX_SOURCE_BYTES) {
                result.destroy();
                reject(new Error("The linked resource is larger than 15 MB."));
                return;
            }
            const chunks = [];
            let size = 0;
            result.on("data", (chunk) => {
                size += chunk.length;
                if (size > MAX_SOURCE_BYTES) {
                    result.destroy(new Error("The linked resource is larger than 15 MB."));
                    return;
                }
                chunks.push(chunk);
            });
            result.on("end", () => resolve({
                buffer: Buffer.concat(chunks),
                contentType: String(result.headers["content-type"] || "").split(";")[0].trim().toLowerCase(),
                url: url.toString(),
            }));
            result.on("error", reject);
        });
        request.setTimeout(15000, () => request.destroy(new Error("The resource server timed out.")));
        request.on("error", reject);
    });
    if (response.redirect) return fetchPublicResource(response.redirect, redirects + 1);
    return response;
}

function decodeHtmlEntities(value) {
    return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
        const key = entity.toLowerCase();
        if (key.startsWith("#x")) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
        if (key.startsWith("#")) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
        return ({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " })[key] || match;
    });
}

async function extractReadableContent(buffer, contentType) {
    if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
        const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const document = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false }).promise;
        try {
            if (document.numPages > 300) throw new Error("PDFs with more than 300 pages cannot be processed.");
            const pages = [];
            for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
                const page = await document.getPage(pageNumber);
                const content = await page.getTextContent();
                pages.push(content.items.map((item) => "str" in item ? item.str : "").filter(Boolean).join(" "));
            }
            const text = pages.join("\n").replace(/\s+/g, " ").trim();
            if (text.length < 20) throw new Error("No readable text was found. Scanned/image-only PDFs are not supported.");
            return text.slice(0, 2_000_000);
        } finally {
            await document.destroy();
        }
    }
    if (contentType === "text/plain") return buffer.toString("utf8").replace(/\s+/g, " ").trim().slice(0, 2_000_000);
    if (contentType === "text/html" || contentType === "application/xhtml+xml") {
        const html = buffer.toString("utf8")
            .replace(/<(script|style|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
            .replace(/<!--[\s\S]*?-->/g, " ")
            .replace(/<[^>]+>/g, " ");
        const text = decodeHtmlEntities(html).replace(/\s+/g, " ").trim();
        if (text.length < 40) throw new Error("The page did not contain enough readable text to index.");
        return text.slice(0, 2_000_000);
    }
    throw new Error("Only readable HTML, plain text, or text-based PDF resources can be processed.");
}

function splitIntoChunks(content, chunkSize = 1600, overlap = 240) {
    const normalized = content.replace(/\s+/g, " ").trim();
    const chunks = [];
    for (let start = 0; start < normalized.length; start += chunkSize - overlap) {
        const chunk = normalized.slice(start, start + chunkSize).trim();
        if (chunk) chunks.push(chunk);
    }
    return chunks;
}

function storagePath(storageKey) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storageKey || "")) {
        throw new Error("Invalid learning material storage key.");
    }
    return path.join(STORAGE_ROOT, `${storageKey}.pdf`);
}

async function storePdf(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.length > MAX_SOURCE_BYTES || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new Error("Upload a valid PDF file no larger than 15 MB.");
    }
    const storageKey = crypto.randomUUID();
    await fs.mkdir(STORAGE_ROOT, { recursive: true, mode: 0o700 });
    await fs.writeFile(storagePath(storageKey), buffer, { flag: "wx", mode: 0o600 });
    return storageKey;
}

async function processMaterial(materialId, providedSource = null) {
    const claimed = await pool.query(`UPDATE curriculum_materials SET processing_status = 'processing',
        processing_started_at = now(), processing_error = '', updated_at = now()
        WHERE id = $1 AND processing_status = 'pending'
        RETURNING id, source_type, url, storage_key, content_revision`, [materialId]);
    if (!claimed.rows[0]) return;
    try {
        const material = claimed.rows[0];
        let source = providedSource;
        if (!source && material.source_type === "upload") {
            const file = await fs.readFile(storagePath(material.storage_key));
            source = { buffer: file, contentType: "application/pdf", url: "" };
        } else if (!source) {
            source = await fetchPublicResource(material.url);
        }
        const readableText = source.readableText || await extractReadableContent(source.buffer, source.contentType);
        const chunks = splitIntoChunks(readableText);
        if (!chunks.length) throw new Error("No readable content was available to index.");
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const current = await client.query("SELECT content_revision FROM curriculum_materials WHERE id = $1 FOR UPDATE", [materialId]);
            if (!current.rows[0] || current.rows[0].content_revision !== material.content_revision) {
                await client.query("ROLLBACK");
                return;
            }
            await client.query("DELETE FROM learning_material_chunks WHERE material_id = $1", [materialId]);
            for (const [index, content] of chunks.entries()) {
                await client.query(`INSERT INTO learning_material_chunks (material_id, chunk_index, content, source_reference, search_vector)
                    VALUES ($1, $2, $3, $4, to_tsvector('simple', $3))`, [materialId, index, content, source.url || ""]);
            }
            await client.query(`UPDATE curriculum_materials SET processing_status = 'completed',
                processing_started_at = NULL, processing_error = '', processed_at = now(), updated_at = now()
                WHERE id = $1 AND content_revision = $2`, [materialId, material.content_revision]);
            await client.query("COMMIT");
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 1000) : "The material could not be processed.";
        await pool.query(`UPDATE curriculum_materials SET processing_status = 'failed',
            processing_started_at = NULL, processing_error = $2, processed_at = now(), updated_at = now()
            WHERE id = $1 AND content_revision = $3`, [materialId, message, claimed.rows[0].content_revision]);
        throw error;
    }
}

function queueMaterialProcessing(materialId, source = null) {
    setImmediate(() => {
        processMaterial(materialId, source).catch((error) => {
            console.error("LEARNING MATERIAL PROCESSING ERROR:", materialId, error.message);
        });
    });
}

async function recoverPendingMaterials() {
    await pool.query(`UPDATE curriculum_materials SET processing_status = 'pending', processing_started_at = NULL,
        processing_error = 'Processing was interrupted and has been queued again.', updated_at = now()
        WHERE processing_status = 'processing' AND processing_started_at < now() - interval '30 minutes'`);
    const result = await pool.query("SELECT id FROM curriculum_materials WHERE processing_status = 'pending' ORDER BY created_at");
    for (const material of result.rows) queueMaterialProcessing(material.id);
    return result.rows.length;
}

module.exports = {
    MAX_SOURCE_BYTES,
    STORAGE_ROOT,
    extractReadableContent,
    fetchPublicResource,
    processMaterial,
    queueMaterialProcessing,
    recoverPendingMaterials,
    splitIntoChunks,
    storagePath,
    storePdf,
    validateResourceUrl,
};
