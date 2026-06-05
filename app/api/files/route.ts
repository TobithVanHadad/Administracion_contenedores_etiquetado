import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { addFilesToOrder, clearFilesFromOrder, deleteFileFromOrder, readOrders } from "@/lib/server-store";
import { uid } from "@/lib/order-utils";
import { uploadDir } from "@/lib/storage";
import { FileType, LinkedFile } from "@/lib/types";

export const runtime = "nodejs";

const allowedExtensions = new Set([".nlbl", ".btw", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"]);
const labelSizeCatalog: Record<string, string> = {
  L7: "6.4x3.8",
  L6: "10.2x7.6",
  L5: "3.0x2.2",
  L4: "2.5x5.1",
  L3: "7.0x7.0",
  L2: "7.6x5.1",
  L1: "6.3x5.1"
};

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

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseFileMetadata(formData: FormData) {
  const raw = formData.get("fileMetadata");
  if (typeof raw !== "string" || !raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Array<Partial<LinkedFile>>) : [];
  } catch {
    return [];
  }
}

function metadataFileType(value: unknown): FileType | undefined {
  return value === "nlbl" || value === "btw" || value === "imagen" || value === "pdf" || value === "drive" || value === "otro"
    ? value
    : undefined;
}

function detectSku(filename: string, skus: string[]) {
  const normalized = filename.toLowerCase();
  return [...skus]
    .sort((a, b) => b.length - a.length)
    .find((sku) => sku && normalized.includes(sku.toLowerCase()));
}

function detectLabelSize(filename: string) {
  const normalized = filename.toUpperCase();
  const match = normalized.match(/(?:^|[^A-Z0-9])(L[1-7])(?:[^0-9]|$)/);
  const code = match?.[1];
  return code ? { code, size: labelSizeCatalog[code] } : undefined;
}

function detectLabelCategory(filename: string, extension: string) {
  const normalized = filename.toLowerCase();
  if (normalized.includes("caja") || normalized.includes("case") || normalized.includes("carton")) return "Caja";
  if (normalized.includes("producto") || normalized.includes("product")) return "Producto";
  if (normalized.includes("orden") || normalized.includes("order")) return "Orden";
  if (extension === ".btw" || extension === ".nlbl") return "Etiqueta";
  if (extension === ".pdf") return "PDF";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) return "Imagen";
  return "General";
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

  const fullPath = path.join(uploadDir, file.sourceOrderId || order.id, file.storedName);
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
    const overwriteExisting = String(formData.get("overwriteExisting") || "") === "1";
    const uploadedFiles = formData.getAll("files").filter((file): file is File => file instanceof File);
    const metadataList = parseFileMetadata(formData);

    if (!orderId) return NextResponse.json({ error: "Falta pedido." }, { status: 400 });
    if (uploadedFiles.length === 0) return NextResponse.json({ error: "No se recibieron archivos." }, { status: 400 });

    const orders = await readOrders();
    const order = orders.find((candidate) => candidate.id === orderId);
    if (!order) return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });

    const skus = order.lines.map((line) => line.sku);
    const linkedFiles: LinkedFile[] = [];
    const rejectedFiles: Array<{ name: string; reason: string }> = [];

    for (let fileIndex = 0; fileIndex < uploadedFiles.length; fileIndex += 1) {
      const file = uploadedFiles[fileIndex];
      const metadata = metadataList[fileIndex] ?? {};
      const extension = path.extname(file.name).toLowerCase();
      if (!allowedExtensions.has(extension)) {
        rejectedFiles.push({ name: file.name, reason: "Tipo de archivo no permitido." });
        continue;
      }

      const id = uid("file");
      const storedName = `${id}-${safeName(file.name)}`;
      const metadataSku = cleanText(metadata.sku);
      const detectedSku = metadataSku && skus.includes(metadataSku) ? metadataSku : detectSku(file.name, skus);
      const line = detectedSku ? order.lines.find((candidate) => candidate.sku === detectedSku) : undefined;
      const detectedLabelSize = detectLabelSize(file.name);
      const metadataLabelSizeCode = cleanText(metadata.labelSizeCode).toUpperCase();
      const labelSizeCode = metadataLabelSizeCode || detectedLabelSize?.code;
      const labelSize = labelSizeCode ? labelSizeCatalog[labelSizeCode] || cleanText(metadata.labelSize) : detectedLabelSize?.size;
      const labelCategory = cleanText(metadata.labelCategory) || detectLabelCategory(file.name, extension);
      const labelVariant = cleanText(metadata.labelVariant);
      const displayName = cleanText(metadata.name) || file.name;
      const originalName = cleanText(metadata.originalName) || file.name;
      const fileType = metadataFileType(metadata.type) ?? fileTypeFromExtension(extension);

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
        type: fileType,
        name: displayName,
        url: `/api/files?fileId=${encodeURIComponent(id)}`,
        sku: detectedSku,
        lineId: line?.id,
        labelSizeCode: labelSizeCode || undefined,
        labelSize: labelSize || undefined,
        labelCategory,
        labelVariant: labelVariant || undefined,
        originalName,
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

    const { orders: updatedOrders, removedFiles } = await addFilesToOrder(orderId, linkedFiles, { user, pin }, { overwriteExisting });
    for (const removedFile of removedFiles) {
      if (removedFile.storedName && (!removedFile.sourceOrderId || removedFile.sourceOrderId === orderId)) {
        await unlink(path.join(uploadDir, orderId, removedFile.storedName)).catch(() => undefined);
      }
    }

    return NextResponse.json({ orders: updatedOrders, uploaded: linkedFiles, rejected: rejectedFiles, replaced: removedFiles });
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
    const clearAll = Boolean(body.clearAll);

    if (!orderId || (!fileId && !clearAll)) {
      return NextResponse.json({ error: "Falta pedido o archivo." }, { status: 400 });
    }

    if (clearAll) {
      const { orders, removedFiles } = await clearFilesFromOrder(orderId, { user, pin });
      for (const removedFile of removedFiles) {
        if (removedFile.storedName && (!removedFile.sourceOrderId || removedFile.sourceOrderId === orderId)) {
          await unlink(path.join(uploadDir, orderId, removedFile.storedName)).catch(() => undefined);
        }
      }

      return NextResponse.json({ orders, removed: removedFiles.length });
    }

    const { orders, removedFile } = await deleteFileFromOrder(orderId, fileId, { user, pin });
    if (removedFile?.storedName && (!removedFile.sourceOrderId || removedFile.sourceOrderId === orderId)) {
      await unlink(path.join(uploadDir, orderId, removedFile.storedName)).catch(() => undefined);
    }

    return NextResponse.json({ orders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo eliminar el archivo." }, { status: 400 });
  }
}
