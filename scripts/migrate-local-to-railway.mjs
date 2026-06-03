import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_SOURCE = "http://127.0.0.1:3010";
const DEFAULT_TARGET = "https://administracioncontenedoresetiquetado-production.up.railway.app";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  const next = process.argv[index + 1];
  if (key.startsWith("--")) {
    args.set(key.slice(2), next && !next.startsWith("--") ? next : "true");
    if (next && !next.startsWith("--")) index += 1;
  }
}

const source = normalizeBaseUrl(args.get("source") || DEFAULT_SOURCE);
const target = normalizeBaseUrl(args.get("target") || DEFAULT_TARGET);
const user = args.get("user") || "Diana";
const pin = args.get("pin") || "1002";
const dataDir = path.resolve(args.get("dataDir") || process.env.ORVEL_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || "data");

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}

function contentTypeFor(name = "") {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

async function readJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `${response.status} ${response.statusText}`);
  }
  return data;
}

function splitFiles(order) {
  const storedFiles = [];
  const externalFiles = [];

  for (const file of order.files ?? []) {
    if (file.storedName) storedFiles.push(file);
    else externalFiles.push(file);
  }

  return { storedFiles, externalFiles };
}

const localData = await readJson(`${source}/api/orders`);
const localOrders = Array.isArray(localData.orders) ? localData.orders : [];
const storedFilesByOrder = new Map();

const ordersForCloud = localOrders.map((order) => {
  const { storedFiles, externalFiles } = splitFiles(order);
  storedFilesByOrder.set(order.id, storedFiles);
  return {
    ...order,
    files: externalFiles
  };
});

console.log(`Pedidos locales detectados: ${localOrders.length}`);
console.log(`Subiendo pedidos a: ${target}`);

const replaced = await readJson(`${target}/api/orders`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "replaceAll",
    orders: ordersForCloud,
    user,
    pin
  })
});

console.log(`Pedidos en nube despues de reemplazo: ${replaced.orders?.length ?? 0}`);

let uploadedFiles = 0;
let skippedFiles = 0;

for (const order of localOrders) {
  const storedFiles = storedFilesByOrder.get(order.id) ?? [];
  if (storedFiles.length === 0) continue;

  const formData = new FormData();
  formData.append("orderId", order.id);
  formData.append("user", user);
  formData.append("pin", pin);

  let filesForOrder = 0;

  for (const file of storedFiles) {
    const fullPath = path.join(dataDir, "uploads", order.id, file.storedName);
    if (!existsSync(fullPath)) {
      skippedFiles += 1;
      console.log(`Archivo omitido, no existe: ${fullPath}`);
      continue;
    }

    const bytes = await readFile(fullPath);
    const originalName = file.originalName || file.name || file.storedName;
    formData.append("files", new File([bytes], originalName, { type: file.mimeType || contentTypeFor(originalName) }));
    filesForOrder += 1;
  }

  if (filesForOrder === 0) continue;

  const result = await readJson(`${target}/api/files`, {
    method: "POST",
    body: formData
  });

  uploadedFiles += result.uploaded?.length ?? 0;
  skippedFiles += result.rejected?.length ?? 0;
  console.log(
    `${order.code}: ${result.uploaded?.length ?? 0} archivo(s) subidos, ${result.rejected?.length ?? 0} rechazado(s).`
  );
}

const finalData = await readJson(`${target}/api/orders`);
console.log(`Migracion terminada. Pedidos finales en nube: ${finalData.orders?.length ?? 0}`);
console.log(`Archivos subidos: ${uploadedFiles}. Omitidos/rechazados: ${skippedFiles}.`);
