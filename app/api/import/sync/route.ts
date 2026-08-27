import readXlsxFile from "read-excel-file/universal";
import { NextRequest, NextResponse } from "next/server";
import { parseMatrixRows } from "@/lib/importer";
import { syncImportedWorkbook } from "@/lib/server-store";
import { OrderDestination, Priority } from "@/lib/types";

export const runtime = "nodejs";

const defaultExcludedSheets = ["MASTER", "BODEGA", "DV", "CAT"];

type SyncRequestData = {
  fileName: string;
  workbookBuffer: ArrayBuffer;
  user: string;
  pin: string;
  excludedSheets: string[];
  defaultCustomer: string;
  defaultOwner: string;
  defaultDestination: OrderDestination;
  defaultPriority: Priority;
  defaultDispatchDate: string;
  removeMissingLines: boolean;
};

function normalizeSheetName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseStringList(value: unknown, fallback: string[]) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return fallback;

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return fallback;
}

function parseDestination(value: unknown): OrderDestination {
  return value === "usa" || value === "europa" || value === "otro" || value === "mexico" ? value : "mexico";
}

function parsePriority(value: unknown): Priority {
  return value === "critica" || value === "alta" || value === "baja" || value === "media" ? value : "media";
}

function parseBoolean(value: unknown) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function bufferToArrayBuffer(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function arrayBufferFromBase64(value: unknown) {
  const raw = String(value || "").replace(/^data:[^;]+;base64,/, "");
  if (!raw) throw new Error("No se recibio contenido del Excel.");

  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) throw new Error("El contenido del Excel esta vacio.");
  return bufferToArrayBuffer(buffer);
}

async function readSyncRequestData(request: NextRequest): Promise<SyncRequestData> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    const fileName = String(body.fileName || "Contenedores Orvel Europa.xlsx");

    if (!fileName.toLowerCase().endsWith(".xlsx")) {
      throw new Error("Sube el workbook como .xlsx.");
    }

    return {
      fileName,
      workbookBuffer: arrayBufferFromBase64(body.fileBase64),
      user: String(body.user || ""),
      pin: String(body.pin || ""),
      excludedSheets: parseStringList(body.excludedSheets, defaultExcludedSheets),
      defaultCustomer: String(body.defaultCustomer || "CREVEL"),
      defaultOwner: String(body.defaultOwner || "Operaciones MX"),
      defaultDestination: parseDestination(body.defaultDestination),
      defaultPriority: parsePriority(body.defaultPriority),
      defaultDispatchDate: String(body.defaultDispatchDate || todayString()).slice(0, 10),
      removeMissingLines: parseBoolean(body.removeMissingLines)
    };
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("No se recibio archivo Excel.");
  }

  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Sube el workbook como .xlsx.");
  }

  return {
    fileName: file.name,
    workbookBuffer: await file.arrayBuffer(),
    user: String(formData.get("user") || ""),
    pin: String(formData.get("pin") || ""),
    excludedSheets: parseStringList(formData.get("excludedSheets"), defaultExcludedSheets),
    defaultCustomer: String(formData.get("defaultCustomer") || "CREVEL"),
    defaultOwner: String(formData.get("defaultOwner") || "Operaciones MX"),
    defaultDestination: parseDestination(formData.get("defaultDestination")),
    defaultPriority: parsePriority(formData.get("defaultPriority")),
    defaultDispatchDate: String(formData.get("defaultDispatchDate") || todayString()).slice(0, 10),
    removeMissingLines: String(formData.get("removeMissingLines") || "") === "1"
  };
}

export async function POST(request: NextRequest) {
  try {
    const data = await readSyncRequestData(request);
    const excludedSheets = data.excludedSheets;
    const excluded = new Set(excludedSheets.map(normalizeSheetName));
    const workbookSheets = await readXlsxFile(data.workbookBuffer);
    const parsedSheets = workbookSheets
      .filter((sheet) => !excluded.has(normalizeSheetName(sheet.sheet)))
      .map((sheet) => {
        const parsed = parseMatrixRows(sheet.data as unknown[][]);
        return {
          sheetName: sheet.sheet,
          rows: parsed.rows,
          headerRow: parsed.headerRow,
          headers: parsed.headers
        };
      });

    const result = await syncImportedWorkbook(
      parsedSheets,
      {
        user: data.user,
        pin: data.pin
      },
      {
        sourceName: data.fileName,
        defaultCustomer: data.defaultCustomer,
        defaultOwner: data.defaultOwner,
        defaultDestination: data.defaultDestination,
        defaultPriority: data.defaultPriority,
        defaultDispatchDate: data.defaultDispatchDate,
        removeMissingLines: data.removeMissingLines
      }
    );

    return NextResponse.json({
      orders: result.orders,
      summary: result.summary,
      skippedSheets: workbookSheets
        .filter((sheet) => excluded.has(normalizeSheetName(sheet.sheet)))
        .map((sheet) => sheet.sheet),
      message: `${result.summary.filter((item) => item.status === "created").length} creado(s), ${result.summary.filter((item) => item.status === "updated").length} actualizado(s), ${result.summary.filter((item) => item.status === "skipped").length} omitido(s).`
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo sincronizar el workbook." },
      { status: 400 }
    );
  }
}
