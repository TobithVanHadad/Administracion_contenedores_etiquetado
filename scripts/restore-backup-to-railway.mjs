import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_TARGET = "https://administracioncontenedoresetiquetado-production.up.railway.app";
const MAX_FILES_PER_BATCH = 8;
const MAX_BATCH_BYTES = 6 * 1024 * 1024;

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  const next = process.argv[index + 1];
  if (key.startsWith("--")) {
    args.set(key.slice(2), next && !next.startsWith("--") ? next : "true");
    if (next && !next.startsWith("--")) index += 1;
  }
}

const backupRoot = path.resolve(args.get("backup") || "backups/railway-full-before-client-filter-push-20260605-083108");
const target = normalizeBaseUrl(args.get("target") || DEFAULT_TARGET);
const user = args.get("user") || "Gloria";
const pin = args.get("pin") || "1002";

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}

async function readJsonFile(filePath) {
  const text = (await readFile(filePath, "utf-8")).replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

async function readJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function metadataFor(entry) {
  return {
    name: entry.name,
    originalName: entry.originalName || entry.name,
    type: entry.type,
    sku: entry.sku,
    labelSizeCode: entry.labelSizeCode,
    labelSize: entry.labelSize,
    labelCategory: entry.labelCategory,
    labelVariant: entry.labelVariant
  };
}

async function uploadBatch(orderId, batch) {
  const form = new FormData();
  form.append("orderId", orderId);
  form.append("user", user);
  form.append("pin", pin);
  form.append("overwriteExisting", "0");
  form.append("fileMetadata", JSON.stringify(batch.map(metadataFor)));

  for (const entry of batch) {
    const bytes = await readFile(entry.path);
    const filename = entry.originalName || entry.name || `${entry.fileId}.bin`;
    form.append("files", new Blob([bytes], { type: "application/octet-stream" }), filename);
  }

  return readJson(`${target}/api/files`, { method: "POST", body: form });
}

const orders = await readJsonFile(path.join(backupRoot, "orders.json"));
const manifest = await readJsonFile(path.join(backupRoot, "manifest.json"));
const downloaded = asArray(manifest.downloaded);
const downloadedIds = new Set(downloaded.map((entry) => entry.fileId));
const ordersWithoutStoredFiles = orders.map((order) => ({
  ...order,
  files: asArray(order.files).filter((file) => !downloadedIds.has(file.id))
}));

console.log(`Restaurando ${orders.length} pedido(s) en ${target}`);

await readJson(`${target}/api/orders`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "replaceAll", orders: ordersWithoutStoredFiles, user, pin })
});

const byOrder = new Map();
for (const entry of downloaded) {
  if (!byOrder.has(entry.orderId)) byOrder.set(entry.orderId, []);
  byOrder.get(entry.orderId).push(entry);
}

let uploaded = 0;
let rejected = 0;
let batches = 0;

for (const [orderId, entries] of byOrder.entries()) {
  let batch = [];
  let batchBytes = 0;

  for (const entry of entries) {
    const fileStat = await stat(entry.path);
    const overflow = batch.length > 0 && (batch.length >= MAX_FILES_PER_BATCH || batchBytes + fileStat.size > MAX_BATCH_BYTES);

    if (overflow) {
      const result = await uploadBatch(orderId, batch);
      uploaded += asArray(result.uploaded).length;
      rejected += asArray(result.rejected).length;
      batches += 1;
      batch = [];
      batchBytes = 0;
    }

    batch.push(entry);
    batchBytes += fileStat.size;
  }

  if (batch.length) {
    const result = await uploadBatch(orderId, batch);
    uploaded += asArray(result.uploaded).length;
    rejected += asArray(result.rejected).length;
    batches += 1;
  }
}

const finalData = await readJson(`${target}/api/orders`);
const finalOrders = asArray(finalData.orders);
const finalFiles = finalOrders.reduce((sum, order) => sum + asArray(order.files).length, 0);

console.log(`Restauracion terminada. Pedidos: ${finalOrders.length}. Archivos/links: ${finalFiles}.`);
console.log(`Subidos: ${uploaded}. Rechazados: ${rejected}. Lotes: ${batches}.`);
