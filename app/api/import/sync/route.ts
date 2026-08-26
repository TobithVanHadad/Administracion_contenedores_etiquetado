import readXlsxFile from "read-excel-file/universal";
import { NextRequest, NextResponse } from "next/server";
import { parseMatrixRows } from "@/lib/importer";
import { syncImportedWorkbook } from "@/lib/server-store";
import { OrderDestination, Priority } from "@/lib/types";

export const runtime = "nodejs";

const defaultExcludedSheets = ["MASTER", "BODEGA", "DV", "CAT"];

function normalizeSheetName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseStringList(value: FormDataEntryValue | null, fallback: string[]) {
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

function parseDestination(value: FormDataEntryValue | null): OrderDestination {
  return value === "usa" || value === "europa" || value === "otro" || value === "mexico" ? value : "mexico";
}

function parsePriority(value: FormDataEntryValue | null): Priority {
  return value === "critica" || value === "alta" || value === "baja" || value === "media" ? value : "media";
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No se recibio archivo Excel." }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return NextResponse.json({ error: "Sube el workbook como .xlsx." }, { status: 400 });
    }

    const excludedSheets = parseStringList(formData.get("excludedSheets"), defaultExcludedSheets);
    const excluded = new Set(excludedSheets.map(normalizeSheetName));
    const workbookSheets = await readXlsxFile(await file.arrayBuffer());
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
        user: String(formData.get("user") || ""),
        pin: String(formData.get("pin") || "")
      },
      {
        sourceName: file.name,
        defaultCustomer: String(formData.get("defaultCustomer") || "CREVEL"),
        defaultOwner: String(formData.get("defaultOwner") || "Operaciones MX"),
        defaultDestination: parseDestination(formData.get("defaultDestination")),
        defaultPriority: parsePriority(formData.get("defaultPriority")),
        defaultDispatchDate: String(formData.get("defaultDispatchDate") || todayString()).slice(0, 10),
        removeMissingLines: String(formData.get("removeMissingLines") || "") === "1"
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
