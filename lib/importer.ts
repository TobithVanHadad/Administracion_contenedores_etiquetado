import { ImportPreviewRow, Priority } from "./types";

const aliases: Record<string, string[]> = {
  sku: ["sku", "code", "codigo", "código", "item", "producto"],
  description: ["description", "descripcion", "descripción", "drescription", "rescription", "producto", "nombre"],
  quantity: ["pedido", "cantidad", "qty", "cases", "cajas"],
  piecesPerCase: ["p/caja", "piezas caja", "piezas/caja", "units/displays per case"],
  labelCode: ["codigo etiqueta", "código etiqueta", "cod etiqueta", "cod etiqueta unidad"],
  caseLabelCode: ["codigo etiqueta caja", "código etiqueta caja", "etiqueta caja"],
  expirationDate: ["caducidad", "expiration", "fecha caducidad"],
  weightKg: ["weight", "peso", "case weight kgs", "peso kg"],
  volumeM3: ["volume", "volumen", "volume m3"],
  satCode: ["clave sat", "codigo sat", "código sat"],
  taricCode: ["taric code", "taric"],
  comments: ["comentarios", "comments", "notas"],
  pedido: ["pedido/proyecto", "proyecto", "contenedor", "orden"],
  cliente: ["cliente", "customer"],
  prioridad: ["prioridad", "priority"],
  responsable: ["responsable", "owner"],
  fechaDespacho: ["fecha despacho", "despacho", "dispatch date", "fecha de despacho"]
};

function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findField(header: string) {
  const normalized = normalizeHeader(header);

  for (const [field, names] of Object.entries(aliases)) {
    if (names.some((name) => normalizeHeader(name) === normalized)) {
      return field;
    }
  }

  return undefined;
}

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toPriority(value: unknown): Priority | undefined {
  const normalized = normalizeHeader(String(value ?? ""));
  if (normalized.includes("crit")) return "critica";
  if (normalized.includes("alta")) return "alta";
  if (normalized.includes("baja")) return "baja";
  if (normalized.includes("media")) return "media";
  return undefined;
}

function toDateString(value: unknown) {
  if (!value) return undefined;

  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    excelEpoch.setUTCDate(excelEpoch.getUTCDate() + value);
    return excelEpoch.toISOString().slice(0, 10);
  }

  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return String(value);
}

export function parseTableText(input: string): ImportPreviewRow[] {
  const rows = input
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  if (rows.length < 2) return [];

  const delimiter = rows[0].includes("\t") ? "\t" : ",";
  const headers = rows[0].split(delimiter).map((header) => header.trim());

  return rows.slice(1).map((row, index) => {
    const cells = row.split(delimiter);
    return normalizeRow(headers, cells, index);
  });
}

export function parseJsonRows(rows: Record<string, unknown>[]): ImportPreviewRow[] {
  return rows.map((row, index) => {
    const headers = Object.keys(row);
    const cells = headers.map((header) => row[header]);
    return normalizeRow(headers, cells, index);
  });
}

export function parseMatrixRows(matrix: unknown[][]): { rows: ImportPreviewRow[]; headerRow: number; headers: string[] } {
  const headerIndex = detectHeaderRow(matrix);
  const headers = (matrix[headerIndex] ?? []).map((header, index) => String(header ?? `Columna ${index + 1}`).trim());
  const rows = matrix
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ""))
    .map((row, index) => normalizeRow(headers, row, index));

  return {
    rows,
    headerRow: headerIndex + 1,
    headers
  };
}

function detectHeaderRow(matrix: unknown[][]) {
  let bestIndex = 0;
  let bestScore = 0;

  matrix.slice(0, 30).forEach((row, index) => {
    const score = row.reduce<number>((count, cell) => {
      if (cell === null || cell === undefined) return count;
      return count + (findField(String(cell)) ? 1 : 0);
    }, 0);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore >= 2 ? bestIndex : 0;
}

function normalizeRow(headers: string[], cells: unknown[], index: number): ImportPreviewRow {
  const row: ImportPreviewRow = {
    id: `preview-${index}-${Date.now()}`,
    originalData: {},
    sourceColumns: headers.filter(Boolean)
  };

  headers.forEach((header, cellIndex) => {
    const cleanHeader = header || `Columna ${cellIndex + 1}`;
    const rawValue = cells[cellIndex] ?? "";
    row.originalData![cleanHeader] = normalizeCellValue(rawValue);
    const field = findField(header);
    if (!field) return;

    const value = rawValue;
    if (field === "quantity" || field === "piecesPerCase" || field === "weightKg" || field === "volumeM3") {
      row[field] = toNumber(value) as never;
      return;
    }

    if (field === "prioridad") {
      row.prioridad = toPriority(value);
      return;
    }

    if (field === "expirationDate" || field === "fechaDespacho") {
      row[field] = toDateString(value) as never;
      return;
    }

    row[field as keyof ImportPreviewRow] = String(value ?? "").trim() as never;
  });

  return row;
}

function normalizeCellValue(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value === null || value === undefined) return "";
  return String(value).trim();
}
