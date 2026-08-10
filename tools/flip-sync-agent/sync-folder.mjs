import { File } from "node:buffer";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const allowedExtensions = new Set([".nlbl", ".btw", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"]);
const maxBatchFiles = 8;
const maxBatchBytes = 6 * 1024 * 1024;

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function normalizeCode(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function mimeTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "application/octet-stream";
}

async function scanFolder(folderPath) {
  const entries = [];

  async function walk(currentPath) {
    const children = await readdir(currentPath, { withFileTypes: true });
    for (const child of children) {
      const childPath = path.join(currentPath, child.name);
      if (child.isDirectory()) {
        await walk(childPath);
        continue;
      }

      if (!child.isFile()) continue;
      const extension = path.extname(child.name).toLowerCase();
      if (!allowedExtensions.has(extension)) continue;

      const info = await stat(childPath);
      entries.push({
        fullPath: childPath,
        relativePath: path.relative(folderPath, childPath).replace(/\\/g, "/"),
        size: info.size
      });
    }
  }

  await walk(folderPath);
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function buildBatches(files) {
  const batches = [];
  let current = [];
  let currentSize = 0;

  for (const file of files) {
    const wouldOverflow = current.length > 0 && (current.length >= maxBatchFiles || currentSize + file.size > maxBatchBytes);
    if (wouldOverflow) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }

    current.push(file);
    currentSize += file.size;
  }

  if (current.length) batches.push(current);
  return batches;
}

async function loadConfig() {
  const configPath = argValue("--config", path.join("tools", "flip-sync-agent", "config.local.json"));
  const absolutePath = path.resolve(configPath);
  const raw = await readFile(absolutePath, "utf-8");
  return { config: JSON.parse(raw), configPath: absolutePath };
}

async function fetchOrders(serverUrl) {
  const response = await fetch(`${serverUrl.replace(/\/$/, "")}/api/orders`);
  if (!response.ok) throw new Error(`No pude leer pedidos de Flip: HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data.orders) ? data.orders : [];
}

function resolveJobs(config, cloudOrders, useServerFolders) {
  if (useServerFolders) {
    return cloudOrders
      .filter((order) => order.labelFolderPath)
      .map((order) => ({
        order,
        folderPath: order.labelFolderPath
      }));
  }

  const ordersByCode = new Map(cloudOrders.map((order) => [normalizeCode(order.code), order]));
  return (config.orders ?? []).map((entry) => {
    const order = entry.orderId
      ? cloudOrders.find((candidate) => candidate.id === entry.orderId)
      : ordersByCode.get(normalizeCode(entry.orderCode));
    return { order, folderPath: entry.folderPath, requested: entry };
  });
}

async function uploadBatch({ serverUrl, user, pin, order, folderPath, batch, overwriteExisting }) {
  const formData = new FormData();
  formData.append("orderId", order.id);
  formData.append("user", user);
  formData.append("pin", pin);
  formData.append("overwriteExisting", overwriteExisting ? "1" : "0");
  formData.append(
    "fileMetadata",
    JSON.stringify(
      batch.map((file) => ({
        syncSource: "desktop_sync",
        folderPath,
        folderName: path.basename(folderPath),
        relativePath: file.relativePath,
        localPath: file.fullPath
      }))
    )
  );

  for (const item of batch) {
    const bytes = await readFile(item.fullPath);
    formData.append("files", new File([bytes], path.basename(item.fullPath), { type: mimeTypeFor(item.fullPath) }));
  }

  const response = await fetch(`${serverUrl.replace(/\/$/, "")}/api/files`, {
    method: "POST",
    body: formData
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function main() {
  const dryRun = hasArg("--dry-run");
  const useServerFolders = hasArg("--use-server-folders");
  const { config, configPath } = await loadConfig();
  const serverUrl = String(config.serverUrl || "").replace(/\/$/, "");
  if (!serverUrl) throw new Error("Falta serverUrl en la configuracion.");
  if (!config.user || !config.pin) throw new Error("Faltan user/pin en la configuracion.");

  console.log(`Config: ${configPath}`);
  console.log(`Servidor: ${serverUrl}`);
  console.log(dryRun ? "Modo: prueba sin subir" : "Modo: sincronizacion real");

  const cloudOrders = await fetchOrders(serverUrl);
  const jobs = resolveJobs(config, cloudOrders, useServerFolders);
  let uploaded = 0;
  let rejected = 0;

  for (const job of jobs) {
    if (!job.order) {
      console.warn(`Pedido no encontrado: ${job.requested?.orderCode || job.requested?.orderId || "sin referencia"}`);
      continue;
    }

    if (!job.folderPath) {
      console.warn(`Sin carpeta para ${job.order.code}`);
      continue;
    }

    const folderPath = path.resolve(job.folderPath);
    const files = await scanFolder(folderPath).catch((error) => {
      console.warn(`No pude leer carpeta de ${job.order.code}: ${error.message}`);
      return [];
    });
    console.log(`${job.order.code}: ${files.length} archivo(s) detectados en ${folderPath}`);

    if (dryRun || files.length === 0) continue;

    const batches = buildBatches(files);
    for (let index = 0; index < batches.length; index += 1) {
      const data = await uploadBatch({
        serverUrl,
        user: config.user,
        pin: config.pin,
        order: job.order,
        folderPath,
        batch: batches[index],
        overwriteExisting: Boolean(config.overwriteExisting)
      });
      uploaded += data.uploaded?.length ?? 0;
      rejected += data.rejected?.length ?? 0;
      console.log(`  lote ${index + 1}/${batches.length}: ${data.uploaded?.length ?? 0} ligados, ${data.rejected?.length ?? 0} descartados`);
    }
  }

  console.log(`Listo. Ligados: ${uploaded}. Descartados: ${rejected}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
