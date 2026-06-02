import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { addFilesToOrder, deleteFileFromOrder, readOrders } from "@/lib/server-store";
import { uid } from "@/lib/order-utils";
import { FileType, LinkedFile } from "@/lib/types";

export const runtime = "nodejs";

const configuredDataDir = process.env.ORVEL_DATA_DIR?.trim() || process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
const dataDir = configuredDataDir
  ? path.resolve(configuredDataDir)
  : path.join(process.cwd(), "data");
const uploadDir = path.join(dataDir, "uploads");
const allowedExtensions = new Set([".nlbl", ".btw", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"]);

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function fileTypeFromExtension(extension: string): FileType {
  if (extension === ".nlbl") return "nlbl";
  if (extension === ".btw") return "btw";
  if (extension === ".pdf") return "pdf";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) return "imagen";
  return "otro";
}

function isPreviewable(extension: string) {
  return extension === ".pdf" || [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension);
}

function contentTypeFor(extension: string, fallback?: string) {
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".btw") return "application/octet-stream";
  if (extension === ".nlbl") return "application/octet-stream";
  return fallback || "application/octet-stream";
}

function detectSku(filename: string, skus: string[]) {
  const normalized = filename.toLowerCase();
  return [...skus]
    .sort((a, b) => b.length - a.length)
    .find((sku) => sku && normalized.includes(sku.toLowerCase()));
}

export async function GET(request: NextRequest) {
  const fileId = request.nextUrl.searchParams.get("fileId");
  if (!fileId) return NextResponse.json({ error: "Falta fileId." }, { status: 400 });

  const orders = await readOrders();
  const order = orders.find((candidate) => candidate.files.some((file) => file.id === fileId));
  const file = order?.files.find((candidate) => candidate.id === fileId);

  if (!order || !file?.storedName) {
    return NextResponse.json({ error: "Archivo no encontrado." }, { status: 404 });
  }

  const fullPath = path.join(uploadDir, order.id, file.storedName);
  const bytes = await readFile(fullPath);
  const extension = path.extname(file.originalName || file.name).toLowerCase();
  const disposition = file.previewable ? "inline" : "attachment";

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": contentTypeFor(extension, file.mimeType),
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(file.originalName || file.name)}"`
    }
  });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const orderId = String(formData.get("orderId") || "");
    const user = String(formData.get("user") || "");
    const pin = String(formData.get("pin") || "");
    const uploadedFiles = formData.getAll("files").filter((file): file is File => file instanceof File);

    if (!orderId) return NextResponse.json({ error: "Falta pedido." }, { status: 400 });
    if (uploadedFiles.length === 0) return NextResponse.json({ error: "No se recibieron archivos." }, { status: 400 });

    const orders = await readOrders();
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order) return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });

    const skus = order.lines.map((line) => line.sku);
    const linkedFiles: LinkedFile[] = [];
    const rejectedFiles: Array<{ name: string; reason: string }> = [];

    for (const file of uploadedFiles) {
      const extension = path.extname(file.name).toLowerCase();
      if (!allowedExtensions.has(extension)) {
        return NextResponse.json({ error: `Tipo no permitido: ${file.name}` }, { status: 400 });
      }
    }

    for (const file of uploadedFiles) {
      const extension = path.extname(file.name).toLowerCase();
      const id = uid("file");
      const storedName = `${id}-${safeName(file.name)}`;
      const detectedSku = detectSku(file.name, skus);
      const line = detectedSku ? order.lines.find((candidate) => candidate.sku === detectedSku) : undefined;

      if (!detectedSku || !line) {
        rejectedFiles.push({ name: file.name, reason: "Sin coincidencia de SKU en el pedido." });
        continue;
      }

      const orderUploadDir = path.join(uploadDir, orderId);
      await mkdir(orderUploadDir, { recursive: true });
      const buffer = Buffer.from(await file.arrayBuffer());

      await writeFile(path.join(orderUploadDir, storedName), buffer);

      linkedFiles.push({
        id,
        type: fileTypeFromExtension(extension),
        name: file.name,
        url: `/api/files?fileId=${encodeURIComponent(id)}`,
        sku: detectedSku,
        lineId: line?.id,
        originalName: file.name,
        storedName,
        mimeType: contentTypeFor(extension, file.type),
        size: file.size,
        previewable: isPreviewable(extension),
        storageStatus: "temporal"
      });
    }

    if (linkedFiles.length === 0) {
      return NextResponse.json({ orders, uploaded: [], rejected: rejectedFiles });
    }

    const updatedOrders = await addFilesToOrder(orderId, linkedFiles, { user, pin });
    return NextResponse.json({ orders: updatedOrders, uploaded: linkedFiles, rejected: rejectedFiles });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron subir archivos." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const orderId = String(body.orderId || "");
    const fileId = String(body.fileId || "");
    const user = String(body.user || "");
    const pin = String(body.pin || "");

    if (!orderId || !fileId) {
      return NextResponse.json({ error: "Falta pedido o archivo." }, { status: 400 });
    }

    const { orders, removedFile } = await deleteFileFromOrder(orderId, fileId, { user, pin });
    if (removedFile?.storedName) {
      await unlink(path.join(uploadDir, orderId, removedFile.storedName)).catch(() => undefined);
    }

    return NextResponse.json({ orders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo eliminar el archivo." }, { status: 400 });
  }
}
