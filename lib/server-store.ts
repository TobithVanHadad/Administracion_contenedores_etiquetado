import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sampleOrders } from "./sample-data";
import { dataDir, ensurePersistentStorage } from "./storage";
import { buildEvent, calculateLineProgress, lineColorLabels, normalizeOrder, statusFromLineProgress, uid } from "./order-utils";
import {
  AppUser,
  ImportPreviewRow,
  LabelDevelopmentStatus,
  LabelRequirement,
  LinkedFile,
  LineColor,
  Order,
  OrderDestination,
  OrderLine,
  Priority,
  PrintRecord,
  UserRole,
  WarehouseLabelingStatus,
  WarehouseStatus
} from "./types";

const legacyJsonFile = path.join(dataDir, "orders.json");
const dbFile = path.join(dataDir, "pedidos-piloto.sqlite");

type AuthPayload = {
  user?: string;
  pin?: string;
};

type StoredUser = AppUser & {
  pinHash: string;
};

type FileUpdate = Partial<
  Pick<LinkedFile, "type" | "name" | "sku" | "labelSizeCode" | "labelSize" | "labelCategory" | "labelVariant">
>;

export type ImportedWorkbookSheet = {
  sheetName: string;
  rows: ImportPreviewRow[];
  headerRow?: number;
  headers?: string[];
};

export type WorkbookSyncSummaryItem = {
  sheetName: string;
  orderCode: string;
  status: "created" | "updated" | "skipped";
  rows: number;
  createdLines: number;
  updatedLines: number;
  keptMissingLines: number;
  removedLines: number;
  reason?: string;
};

export type WorkbookSyncOptions = {
  sourceName?: string;
  defaultCustomer?: string;
  defaultOwner?: string;
  defaultDestination?: OrderDestination;
  defaultPriority?: Priority;
  defaultDispatchDate?: string;
  removeMissingLines?: boolean;
};

let db: DatabaseSync | undefined;
let writeQueue = Promise.resolve();

const labelSizeCatalog: Record<string, string> = {
  L7: "6.4x3.8",
  L6: "10.2x7.6",
  L5: "3.0x2.2",
  L4: "2.5x5.1",
  L3: "7.0x7.0",
  L2: "7.6x5.1",
  L1: "6.3x5.1"
};

const seedUserRows: Array<AppUser & { pin: string; pinHash: string }> = [
  { id: "usr-gloria", name: "Gloria", role: "admin", active: true, pin: "1002", pinHash: "" },
  { id: "usr-cala", name: "Cala", role: "admin", active: true, pin: "1003", pinHash: "" },
  { id: "usr-cristobal", name: "Cristobal", role: "admin", active: true, pin: "1004", pinHash: "" },
  { id: "usr-compras", name: "compras", role: "planning", active: true, pin: "2001", pinHash: "" },
  { id: "usr-almacen", name: "almacen", role: "planning_warehouse", active: true, pin: "3001", pinHash: "" }
];

const seedUsers: Array<StoredUser & { pin: string }> = seedUserRows.map((user) => ({ ...user, pinHash: hashPin(user.pin) }));

function hashPin(pin: string) {
  return createHash("sha256").update(`orvel:${pin}`).digest("hex");
}

async function openDb() {
  await ensurePersistentStorage();

  if (!db) {
    db = new DatabaseSync(dbFile);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        customer TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        dispatch_date TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_orders_archived ON orders(archived);
      CREATE INDEX IF NOT EXISTS idx_orders_dispatch_date ON orders(dispatch_date);

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
    `);

    seedDefaultUsers();
    await seedOrdersIfEmpty();
  }

  return db;
}

function seedDefaultUsers() {
  const database = db;
  if (!database) return;

  const insert = database.prepare(`
    INSERT INTO users (id, name, role, pin_hash, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      id = excluded.id,
      role = excluded.role,
      pin_hash = excluded.pin_hash,
      active = excluded.active
  `);

  const activeNames = seedUsers.map((user) => user.name);
  const placeholders = activeNames.map(() => "?").join(", ");

  for (const user of seedUsers) {
    insert.run(user.id, user.name, user.role, user.pinHash, user.active ? 1 : 0, new Date().toISOString());
  }

  database.prepare(`UPDATE users SET active = 0 WHERE name NOT IN (${placeholders})`).run(...activeNames);
}

async function seedOrdersIfEmpty() {
  const database = db;
  if (!database) return;

  const count = database.prepare("SELECT COUNT(*) AS count FROM orders").get() as { count: number };
  if (count.count > 0) return;

  let sourceOrders = sampleOrders;
  try {
    const raw = await readFile(legacyJsonFile, "utf-8");
    sourceOrders = JSON.parse(raw) as Order[];
  } catch {
    sourceOrders = sampleOrders;
  }

  replaceOrders(sourceOrders.map(normalizeOrder));
}

function rowToOrder(row: { data: string }) {
  return normalizeOrder(JSON.parse(row.data) as Order);
}

function replaceOrders(orders: Order[]) {
  const database = db;
  if (!database) return;

  const now = new Date().toISOString();
  const insert = database.prepare(`
    INSERT INTO orders (id, code, customer, archived, dispatch_date, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  database.exec("BEGIN;");
  try {
    database.exec("DELETE FROM orders;");
    for (const order of orders.map(normalizeOrder)) {
      insert.run(
        order.id,
        order.code,
        order.customer,
        order.archived ? 1 : 0,
        order.dispatchDate,
        JSON.stringify(order),
        order.createdAt || now,
        now
      );
    }
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

function saveOrder(order: Order) {
  const database = db;
  if (!database) return;

  const normalized = normalizeOrder(order);
  database
    .prepare(
      `
        INSERT INTO orders (id, code, customer, archived, dispatch_date, data, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          code = excluded.code,
          customer = excluded.customer,
          archived = excluded.archived,
          dispatch_date = excluded.dispatch_date,
          data = excluded.data,
          updated_at = excluded.updated_at
      `
    )
    .run(
      normalized.id,
      normalized.code,
      normalized.customer,
      normalized.archived ? 1 : 0,
      normalized.dispatchDate,
      JSON.stringify(normalized),
      normalized.createdAt || new Date().toISOString(),
      new Date().toISOString()
    );
}

function readOrdersFromDatabase(database: DatabaseSync) {
  const rows = database.prepare("SELECT data FROM orders ORDER BY archived ASC, dispatch_date ASC, code ASC").all() as Array<{ data: string }>;
  return rows.map(rowToOrder);
}

function normalizeFileKey(value?: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function labelSizeFromCode(code?: string) {
  const normalized = String(code ?? "").toUpperCase();
  return labelSizeCatalog[normalized] ?? "";
}

function resourceIdentity(file: LinkedFile) {
  if (file.sourceOrderId || file.sourceFileId) {
    return [
      file.sourceOrderId || "",
      file.sourceFileId || file.id,
      file.sku || "",
      file.type,
      file.labelSizeCode || "",
      normalizeFileKey(file.originalName || file.name)
    ].join("|");
  }

  return [
    file.id,
    file.url,
    file.sku || "",
    file.type,
    file.labelSizeCode || "",
    normalizeFileKey(file.originalName || file.name)
  ].join("|");
}

function cloneResourceFile(file: LinkedFile, sourceOrder: Order, targetOrder: Order): LinkedFile | undefined {
  if (!file.sku) return undefined;
  const line = targetOrder.lines.find((candidate) => candidate.sku === file.sku);
  if (!line) return undefined;

  const id = uid("file");
  return {
    ...file,
    id,
    url: file.storedName ? `/api/files?fileId=${encodeURIComponent(id)}` : file.url,
    lineId: line.id,
    sourceFileId: file.sourceFileId || file.id,
    sourceOrderId: file.sourceOrderId || sourceOrder.id,
    sourceOrderCode: file.sourceOrderCode || sourceOrder.code,
    storageStatus: "temporal",
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function findReusableFiles(targetOrder: Order, orders: Order[], options: { sourceOrderId?: string } = {}) {
  const existingKeys = new Set(targetOrder.files.map(resourceIdentity));
  const sourceSkus = new Set(targetOrder.lines.map((line) => line.sku).filter(Boolean));
  const targetCustomer = normalizeFileKey(targetOrder.customer);
  const reusableFiles: LinkedFile[] = [];

  for (const sourceOrder of orders) {
    if (sourceOrder.id === targetOrder.id) continue;
    if (options.sourceOrderId) {
      if (sourceOrder.id !== options.sourceOrderId) continue;
    } else if (normalizeFileKey(sourceOrder.customer) !== targetCustomer) {
      continue;
    }

    for (const file of sourceOrder.files) {
      if (!file.sku || !sourceSkus.has(file.sku)) continue;
      const clonedFile = cloneResourceFile(file, sourceOrder, targetOrder);
      if (!clonedFile) continue;

      const key = resourceIdentity(clonedFile);
      if (existingKeys.has(key)) continue;

      existingKeys.add(key);
      reusableFiles.push(clonedFile);
    }
  }

  return reusableFiles;
}

function fileMatchesReplacement(existing: LinkedFile, incoming: LinkedFile) {
  if (!existing.sku || !incoming.sku || existing.sku !== incoming.sku) return false;
  if (existing.type !== incoming.type) return false;

  const sameName =
    normalizeFileKey(existing.originalName || existing.name) === normalizeFileKey(incoming.originalName || incoming.name);
  const sameLabelSize = Boolean(incoming.labelSizeCode && existing.labelSizeCode === incoming.labelSizeCode);
  const sameCategory = normalizeFileKey(existing.labelCategory) === normalizeFileKey(incoming.labelCategory);

  return sameName || (sameLabelSize && sameCategory);
}

function normalizeSyncPath(value?: string) {
  return normalizeFileKey(String(value ?? "").replace(/\\/g, "/"));
}

function sameSyncIdentity(existing: LinkedFile, incoming: LinkedFile) {
  if (!incoming.relativePath && !incoming.localPath) return false;

  const existingPath = normalizeSyncPath(existing.relativePath || existing.localPath);
  const incomingPath = normalizeSyncPath(incoming.relativePath || incoming.localPath);
  if (!existingPath || existingPath !== incomingPath) return false;

  const existingFolder = normalizeSyncPath(existing.folderPath || existing.folderName);
  const incomingFolder = normalizeSyncPath(incoming.folderPath || incoming.folderName);
  if (existingFolder && incomingFolder && existingFolder !== incomingFolder) return false;

  return true;
}

function can(role: UserRole, action: string, field?: keyof Order) {
  if (role === "admin") return true;
  if (role === "consulta") return false;
  const isPlanning = role === "planning" || role === "planning_warehouse" || role === "planeacion";
  const isWarehouse = role === "planning_warehouse" || role === "etiquetado";

  if (action === "create" || action === "changeDispatchDate" || action === "close" || action === "restore") {
    return isPlanning;
  }

  if (action === "syncWorkbook") {
    return isPlanning;
  }

  if (action === "addFile") {
    return isPlanning || role === "etiquetado" || role === "aprobador";
  }

  if (
    action === "addFiles" ||
    action === "updateFileSku" ||
    action === "updateFileMeta" ||
    action === "linkExistingResources" ||
    action === "deleteFile"
  ) {
    return isPlanning || role === "etiquetado" || role === "aprobador";
  }

  if (
    action === "updateLineColor" ||
    action === "updateLineVisibility" ||
    action === "updateLineCell" ||
    action === "addLine" ||
    action === "deleteLine" ||
    action === "updateWarehouseStatus" ||
    action === "updateLabelDevelopmentStatus" ||
    action === "updateWarehouseLabelingStatus" ||
    action === "addLabelRequirement" ||
    action === "deleteLabelRequirement" ||
    action === "recordPrint"
  ) {
    return isPlanning || isWarehouse;
  }

  if (action === "updateField") {
    if (field === "approvalStatus") return isPlanning || role === "aprobador";
    if (field === "labelingStatus") return isPlanning || role === "etiquetado";
    return isPlanning;
  }

  return false;
}

async function authenticate(auth: AuthPayload, action: string, field?: keyof Order) {
  const database = await openDb();
  const name = auth.user?.trim();
  const pin = auth.pin?.trim();

  if (!name || !pin) {
    throw new Error("Ingresa usuario y PIN para guardar cambios.");
  }

  const row = database.prepare("SELECT * FROM users WHERE lower(name) = lower(?) AND active = 1").get(name) as
    | { id: string; name: string; role: UserRole; pin_hash: string; active: number }
    | undefined;

  if (!row || row.pin_hash !== hashPin(pin)) {
    throw new Error("Usuario o PIN incorrecto.");
  }

  if (!can(row.role, action, field)) {
    throw new Error(`El rol ${row.role} no tiene permiso para esta accion.`);
  }

  return { id: row.id, name: row.name, role: row.role, active: row.active === 1 };
}

export async function verifyLogin(auth: AuthPayload) {
  const database = await openDb();
  const name = auth.user?.trim();
  const pin = auth.pin?.trim();

  if (!name || !pin) {
    throw new Error("Ingresa usuario y PIN para acceder.");
  }

  const row = database.prepare("SELECT * FROM users WHERE lower(name) = lower(?) AND active = 1").get(name) as
    | { id: string; name: string; role: UserRole; pin_hash: string; active: number }
    | undefined;

  if (!row || row.pin_hash !== hashPin(pin)) {
    throw new Error("Usuario o PIN incorrecto.");
  }

  return { id: row.id, name: row.name, role: row.role, active: row.active === 1 };
}

function normalizeColumnName(column: string) {
  return column
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function toOptionalNumber(value: string) {
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function applyColumnValue(line: OrderLine, column: string, value: string): OrderLine {
  const next: OrderLine = {
    ...line,
    originalData: {
      ...(line.originalData ?? {}),
      [column]: value
    }
  };
  const normalized = normalizeColumnName(column);

  if (normalized === "code" || normalized === "sku") next.sku = value.trim();
  if (normalized.includes("description") || normalized.includes("drescription") || normalized.includes("descripcion")) {
    next.description = value.trim() || "Sin descripcion";
  }
  if (normalized === "pedido" || normalized.includes("cantidad") || normalized === "qty") next.quantity = toOptionalNumber(value) ?? 0;
  if (normalized.includes("p/caja") || normalized.includes("piezas")) next.piecesPerCase = toOptionalNumber(value);
  if (normalized.includes("codigo etiqueta caja")) next.caseLabelCode = value.trim();
  if (normalized.includes("codigo etiqueta") && !normalized.includes("caja")) next.labelCode = value.trim();
  if (normalized.includes("caducidad") || normalized.includes("expiration")) next.expirationDate = value.trim();
  if (normalized === "weight" || normalized.includes("peso")) next.weightKg = toOptionalNumber(value);
  if (normalized === "volume" || normalized.includes("volumen")) next.volumeM3 = toOptionalNumber(value);
  if (normalized.includes("sat")) next.satCode = value.trim();
  if (normalized.includes("taric")) next.taricCode = value.trim();

  return next;
}

export async function readUsersPublic() {
  const database = await openDb();
  const rows = database.prepare("SELECT id, name, role, active FROM users WHERE active = 1 ORDER BY rowid").all() as Array<{
    id: string;
    name: string;
    role: UserRole;
    active: number;
  }>;

  return rows.map((row) => ({ id: row.id, name: row.name, role: row.role, active: row.active === 1 }));
}

export async function readOrders() {
  const database = await openDb();
  return readOrdersFromDatabase(database);
}

function cleanImportText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeImportKey(value: unknown) {
  return cleanImportText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeWorkbookDate(value?: string) {
  const clean = cleanImportText(value);
  return clean ? clean.slice(0, 10) : "";
}

function inferDestinationFromSheet(sheetName: string, fallback: OrderDestination): OrderDestination {
  const normalized = normalizeImportKey(sheetName);
  if (normalized.includes("usa") || normalized.includes("estados unidos") || normalized.includes("united states")) return "usa";
  if (normalized.includes("europa") || normalized.includes("europe")) return "europa";
  if (normalized.includes("mexico") || normalized.includes("mx")) return "mexico";
  return fallback;
}

function isMissingLabelValue(value?: string) {
  const normalized = normalizeImportKey(value);
  return (
    !normalized ||
    normalized === "n/a" ||
    normalized === "na" ||
    normalized === "#n/a" ||
    normalized.includes("error") ||
    normalized.includes("#ref")
  );
}

function makeLineBuckets(lines: OrderLine[], selector: (line: OrderLine) => string | undefined) {
  const buckets = new Map<string, OrderLine[]>();

  for (const line of lines) {
    const key = normalizeImportKey(selector(line));
    if (!key) continue;
    const bucket = buckets.get(key) ?? [];
    bucket.push(line);
    buckets.set(key, bucket);
  }

  return buckets;
}

function shiftBucket(buckets: Map<string, OrderLine[]>, key: string) {
  const bucket = buckets.get(key);
  if (!bucket?.length) return undefined;
  return bucket.shift();
}

function takeMatchingLine(row: ImportPreviewRow, skuBuckets: Map<string, OrderLine[]>, descriptionBuckets: Map<string, OrderLine[]>) {
  const skuMatch = shiftBucket(skuBuckets, normalizeImportKey(row.sku));
  if (skuMatch) return skuMatch;

  return shiftBucket(descriptionBuckets, normalizeImportKey(row.description));
}

function valueOrPrevious<T>(nextValue: T | undefined, previousValue: T | undefined) {
  return nextValue !== undefined ? nextValue : previousValue;
}

function lineFromImportRow(row: ImportPreviewRow, index: number, existingLine?: OrderLine): OrderLine {
  const sku = cleanImportText(row.sku || existingLine?.sku || `SIN-SKU-${index + 1}`);
  const description = cleanImportText(row.description || existingLine?.description || "Sin descripcion");

  return {
    id: existingLine?.id ?? uid("line"),
    sku,
    description,
    quantity: valueOrPrevious(row.quantity, existingLine?.quantity) ?? 0,
    originalData: row.originalData ?? existingLine?.originalData ?? {},
    lineColor: existingLine?.lineColor ?? "rojo",
    hidden: existingLine?.hidden ?? false,
    warehouseStatus: existingLine?.warehouseStatus ?? "nothing_requested",
    labelDevelopmentStatus: existingLine?.labelDevelopmentStatus ?? "no_ha_llegado",
    warehouseLabelingStatus: existingLine?.warehouseLabelingStatus ?? "no_iniciado",
    labelRequirements: existingLine?.labelRequirements ?? [],
    printHistory: existingLine?.printHistory ?? [],
    piecesPerCase: valueOrPrevious(row.piecesPerCase, existingLine?.piecesPerCase),
    labelCode: valueOrPrevious(row.labelCode, existingLine?.labelCode),
    caseLabelCode: valueOrPrevious(row.caseLabelCode, existingLine?.caseLabelCode),
    expirationDate: valueOrPrevious(row.expirationDate, existingLine?.expirationDate),
    weightKg: valueOrPrevious(row.weightKg, existingLine?.weightKg),
    volumeM3: valueOrPrevious(row.volumeM3, existingLine?.volumeM3),
    satCode: valueOrPrevious(row.satCode, existingLine?.satCode),
    taricCode: valueOrPrevious(row.taricCode, existingLine?.taricCode),
    comments: valueOrPrevious(row.comments, existingLine?.comments)
  };
}

function relinkFilesToLines(files: LinkedFile[], lines: OrderLine[]) {
  const linesBySku = new Map(lines.map((line) => [normalizeImportKey(line.sku), line]));

  return files.map((file) => {
    const line = file.sku ? linesBySku.get(normalizeImportKey(file.sku)) : undefined;
    return {
      ...file,
      lineId: line?.id
    };
  });
}

function uniqueColumns(existingColumns: string[] = [], importedColumns: string[] = [], lines: OrderLine[] = []) {
  return Array.from(
    new Set(
      [
        ...existingColumns,
        ...importedColumns,
        ...lines.flatMap((line) => Object.keys(line.originalData ?? {}))
      ].filter(Boolean)
    )
  );
}

function importedSheetColumns(sheet: ImportedWorkbookSheet, rows: ImportPreviewRow[]) {
  return sheet.headers?.filter(Boolean) ?? rows.find((row) => row.sourceColumns?.length)?.sourceColumns ?? [];
}

export async function syncImportedWorkbook(sheets: ImportedWorkbookSheet[], auth: AuthPayload, options: WorkbookSyncOptions = {}) {
  const user = await authenticate(auth, "syncWorkbook");
  const summary: WorkbookSyncSummaryItem[] = [];
  const sourceName = cleanImportText(options.sourceName) || "workbook";
  const defaultCustomer = cleanImportText(options.defaultCustomer) || "CREVEL";
  const defaultOwner = cleanImportText(options.defaultOwner) || "Operaciones MX";
  const defaultDestination = options.defaultDestination ?? "mexico";
  const defaultPriority = options.defaultPriority ?? "media";
  const defaultDispatchDate = normalizeWorkbookDate(options.defaultDispatchDate) || todayString();

  const orders = await withWrite(async () => {
    const database = await openDb();
    const existingOrders = readOrdersFromDatabase(database);
    const ordersByCode = new Map(existingOrders.map((order) => [normalizeImportKey(order.code), order]));

    for (const sheet of sheets) {
      const orderCode = cleanImportText(sheet.sheetName);
      const meaningfulRows = sheet.rows.filter((row) => row.sku && row.description);
      const usableRows = meaningfulRows.length ? sheet.rows.filter((row) => row.sku || row.description) : [];

      if (!orderCode) {
        summary.push({
          sheetName: sheet.sheetName,
          orderCode: "",
          status: "skipped",
          rows: 0,
          createdLines: 0,
          updatedLines: 0,
          keptMissingLines: 0,
          removedLines: 0,
          reason: "Hoja sin nombre."
        });
        continue;
      }

      if (!usableRows.length) {
        summary.push({
          sheetName: sheet.sheetName,
          orderCode,
          status: "skipped",
          rows: 0,
          createdLines: 0,
          updatedLines: 0,
          keptMissingLines: 0,
          removedLines: 0,
          reason: "Sin lineas con SKU o descripcion."
        });
        continue;
      }

      const existingOrder = ordersByCode.get(normalizeImportKey(orderCode));
      const first = usableRows.find((row) => row.sku || row.description);
      const skuBuckets = makeLineBuckets(existingOrder?.lines ?? [], (line) => line.sku);
      const descriptionBuckets = makeLineBuckets(existingOrder?.lines ?? [], (line) => line.description);
      const matchedLineIds = new Set<string>();
      let createdLines = 0;
      let updatedLines = 0;

      const importedLines = usableRows.map((row, index) => {
        const existingLine = existingOrder ? takeMatchingLine(row, skuBuckets, descriptionBuckets) : undefined;
        if (existingLine) {
          matchedLineIds.add(existingLine.id);
          updatedLines += 1;
        } else {
          createdLines += 1;
        }

        return lineFromImportRow(row, index, existingLine);
      });

      const missingExistingLines = existingOrder?.lines.filter((line) => !matchedLineIds.has(line.id)) ?? [];
      const keptMissingLines = options.removeMissingLines ? 0 : missingExistingLines.length;
      const removedLines = options.removeMissingLines ? missingExistingLines.length : 0;
      const lines = options.removeMissingLines ? importedLines : [...importedLines, ...missingExistingLines];
      const importedColumns = importedSheetColumns(sheet, usableRows);
      const dispatchFromWorkbook = normalizeWorkbookDate(first?.fechaDespacho);
      const priorityFromWorkbook = first?.prioridad;
      const destination = existingOrder?.destination ?? inferDestinationFromSheet(orderCode, defaultDestination);
      const customer = cleanImportText(first?.cliente) || existingOrder?.customer || defaultCustomer;
      const owner = cleanImportText(first?.responsable) || existingOrder?.owner || defaultOwner;
      const priority = priorityFromWorkbook || existingOrder?.priority || defaultPriority;
      const dispatchDate = dispatchFromWorkbook || existingOrder?.dispatchDate || defaultDispatchDate;

      if (existingOrder) {
        const lineProgress = calculateLineProgress(lines);
        const statusUpdate = statusFromLineProgress(existingOrder, lineProgress.progress);
        const nextOrder = normalizeOrder({
          ...existingOrder,
          code: orderCode,
          customer,
          owner,
          destination,
          priority,
          dispatchDate,
          ...statusUpdate,
          columns: uniqueColumns(existingOrder.columns, importedColumns, lines),
          lines,
          files: relinkFilesToLines(existingOrder.files, lines),
          history: [
            buildEvent(
              "excel sync",
              `Sincronizado desde ${sourceName} / ${sheet.sheetName}: ${usableRows.length} linea(s), ${createdLines} nueva(s), ${updatedLines} actualizada(s)${
                keptMissingLines ? `, ${keptMissingLines} conservada(s) aunque ya no estan en Excel` : ""
              }${removedLines ? `, ${removedLines} eliminada(s) porque ya no estan en Excel` : ""}.`,
              user.name
            ),
            ...existingOrder.history
          ]
        });

        saveOrder(nextOrder);
        ordersByCode.set(normalizeImportKey(orderCode), nextOrder);
        summary.push({
          sheetName: sheet.sheetName,
          orderCode,
          status: "updated",
          rows: usableRows.length,
          createdLines,
          updatedLines,
          keptMissingLines,
          removedLines
        });
        continue;
      }

      const missingLabels = importedLines.some((line) => isMissingLabelValue(line.labelCode) || isMissingLabelValue(line.caseLabelCode));
      const newOrder = normalizeOrder({
        id: uid("ord"),
        code: orderCode,
        customer,
        owner,
        destination,
        priority,
        status: missingLabels ? "pendiente_archivos" : "importado",
        labelingStatus: missingLabels ? "bloqueado" : "pendiente",
        approvalStatus: "pendiente",
        dispatchDate,
        createdAt: new Date().toISOString(),
        archived: false,
        progress: 0,
        columns: uniqueColumns([], importedColumns, importedLines),
        lines: importedLines,
        files: [],
        history: [
          buildEvent(
            "excel sync",
            `Pedido creado desde ${sourceName} / ${sheet.sheetName} con ${importedLines.length} linea(s).`,
            user.name
          )
        ]
      });

      const reusableFiles = findReusableFiles(newOrder, readOrdersFromDatabase(database));
      const nextOrder = normalizeOrder({
        ...newOrder,
        files: reusableFiles,
        history: [
          ...(reusableFiles.length ? [buildEvent("recursos", `${reusableFiles.length} archivo(s) existentes ligados por SKU.`, user.name)] : []),
          ...newOrder.history
        ]
      });

      saveOrder(nextOrder);
      ordersByCode.set(normalizeImportKey(orderCode), nextOrder);
      summary.push({
        sheetName: sheet.sheetName,
        orderCode,
        status: "created",
        rows: usableRows.length,
        createdLines,
        updatedLines,
        keptMissingLines,
        removedLines
      });
    }

  });

  return { orders, summary };
}

async function withWrite(mutator: () => Promise<void> | void) {
  const run = async () => {
    await openDb();
    await mutator();
    return readOrders();
  };

  const result = writeQueue.then(run, run);
  writeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export async function resetOrders(auth: AuthPayload) {
  await authenticate(auth, "reset");
  return withWrite(() => replaceOrders(sampleOrders.map(normalizeOrder)));
}

export async function replaceAllOrders(orders: Order[], auth: AuthPayload) {
  const user = await authenticate(auth, "reset");
  const normalizedOrders = orders.map((order) =>
    normalizeOrder({
      ...order,
      history: [buildEvent("migracion", `Pedido migrado a nube por ${user.name}.`, user.name), ...(order.history ?? [])]
    })
  );

  return withWrite(() => replaceOrders(normalizedOrders));
}

export async function createOrder(order: Order, auth: AuthPayload) {
  const user = await authenticate(auth, "create");
  return withWrite(() => {
    const database = db;
    const existingOrders = database ? readOrdersFromDatabase(database) : [];
    const baseOrder = normalizeOrder({
      ...order,
      createdAt: order.createdAt || new Date().toISOString(),
      files: order.files.map((file) => ({
        ...file,
        storageStatus: file.storageStatus ?? "temporal",
        addedAt: file.addedAt ?? new Date().toISOString()
      }))
    });
    const reusableFiles = findReusableFiles(baseOrder, existingOrders);
    const normalized = normalizeOrder({
      ...baseOrder,
      files: [...reusableFiles, ...baseOrder.files],
      history: [
        buildEvent(
          "importacion",
          `Pedido creado con ${order.lines.length} lineas${reusableFiles.length ? ` y ${reusableFiles.length} recurso(s) existentes ligados por SKU.` : "."}`,
          user.name
        ),
        ...(reusableFiles.length ? [buildEvent("recursos", `${reusableFiles.length} archivo(s) detectados desde pedidos anteriores.`, user.name)] : []),
        ...order.history
      ]
    });

    saveOrder(normalized);
  });
}

export async function patchOrder(
  orderId: string,
  action:
    | ({ type: "updateField"; field: keyof Order; value: unknown; label: string } & AuthPayload)
    | ({ type: "changeDispatchDate"; nextDate: string } & AuthPayload)
    | ({ type: "updateLineColor"; lineId: string; color: LineColor } & AuthPayload)
    | ({ type: "updateLineVisibility"; lineId: string; hidden: boolean } & AuthPayload)
    | ({ type: "updateLineCell"; lineId: string; column: string; value: string } & AuthPayload)
    | ({ type: "updateWarehouseStatus"; lineId: string; status: WarehouseStatus } & AuthPayload)
    | ({ type: "updateLabelDevelopmentStatus"; lineId: string; status: LabelDevelopmentStatus } & AuthPayload)
    | ({ type: "updateWarehouseLabelingStatus"; lineId: string; status: WarehouseLabelingStatus } & AuthPayload)
    | ({ type: "addLabelRequirement"; lineId: string; requirement: LabelRequirement } & AuthPayload)
    | ({ type: "deleteLabelRequirement"; lineId: string; requirementId: string } & AuthPayload)
    | ({ type: "recordPrint"; lineId: string; quantity: number; labelType: string; labelSizeCode: string; labelSize: string } & AuthPayload)
    | ({ type: "close" } & AuthPayload)
    | ({ type: "restore" } & AuthPayload)
    | ({ type: "addFile"; file: LinkedFile } & AuthPayload)
    | ({ type: "updateFileSku"; fileId: string; sku: string } & AuthPayload)
    | ({ type: "updateFileMeta"; fileId: string; updates: FileUpdate } & AuthPayload)
    | ({ type: "linkExistingResources"; sourceOrderId?: string } & AuthPayload)
    | ({ type: "deleteFile"; fileId: string } & AuthPayload)
    | ({ type: "addLine"; line: OrderLine } & AuthPayload)
    | ({ type: "deleteLine"; lineId: string } & AuthPayload)
) {
  const user = await authenticate(action, action.type, action.type === "updateField" ? action.field : undefined);

  return withWrite(async () => {
    const database = await openDb();
    const row = database.prepare("SELECT data FROM orders WHERE id = ?").get(orderId) as { data: string } | undefined;
    if (!row) throw new Error("Pedido no encontrado.");

    const order = rowToOrder(row);
    let nextOrder = order;

    if (action.type === "updateField") {
      nextOrder = normalizeOrder({
        ...order,
        [action.field]: action.value,
        history: [buildEvent("actualizacion", action.label, user.name), ...order.history]
      });
    }

    if (action.type === "changeDispatchDate") {
      nextOrder = normalizeOrder({
        ...order,
        dispatchDate: action.nextDate,
        history: [
          buildEvent("fecha despacho", `Fecha de despacho cambiada de ${order.dispatchDate} a ${action.nextDate}.`, user.name),
          ...order.history
        ]
      });
    }

    if (action.type === "updateLineColor") {
      const lines = order.lines.map((line) => (line.id === action.lineId ? { ...line, lineColor: action.color } : line));
      const lineProgress = calculateLineProgress(lines);
      const statusUpdate = statusFromLineProgress(order, lineProgress.progress);
      const sku = lines.find((line) => line.id === action.lineId)?.sku ?? "";

      nextOrder = normalizeOrder({
        ...order,
        ...statusUpdate,
        lines,
        progress: lineProgress.progress,
        history: [
          buildEvent(
            "avance sku",
            `SKU ${sku} marcado como ${lineColorLabels[action.color]}. Avance automatico: ${lineProgress.progress}%.`,
            user.name
          ),
          ...order.history
        ]
      });
    }

    if (action.type === "updateLineVisibility") {
      const updatedLine = order.lines.find((line) => line.id === action.lineId);
      nextOrder = normalizeOrder({
        ...order,
        lines: order.lines.map((line) => (line.id === action.lineId ? { ...line, hidden: action.hidden } : line)),
        history: [
          buildEvent(
            "fila pedido",
            `SKU ${updatedLine?.sku ?? action.lineId}: fila ${action.hidden ? "ocultada" : "visible nuevamente"}.`,
            user.name
          ),
          ...order.history
        ]
      });
    }

    if (action.type === "updateLineCell") {
      const previousLine = order.lines.find((line) => line.id === action.lineId);
      const lines = order.lines.map((line) => (line.id === action.lineId ? applyColumnValue(line, action.column, action.value) : line));
      const nextLine = lines.find((line) => line.id === action.lineId);
      const nextSku = nextLine?.sku || previousLine?.sku || "";

      nextOrder = normalizeOrder({
        ...order,
        lines,
        columns: Array.from(new Set([...(order.columns ?? []), action.column])),
        files: order.files.map((file) =>
          file.lineId === action.lineId || (previousLine?.sku && file.sku === previousLine.sku)
            ? {
                ...file,
                sku: nextSku || undefined,
                lineId: action.lineId
              }
            : file
        ),
        history: [buildEvent("celda", `SKU ${nextSku || action.lineId}: ${action.column} actualizado.`, user.name), ...order.history]
      });
    }

    if (action.type === "updateWarehouseStatus") {
      const updatedLine = order.lines.find((line) => line.id === action.lineId);
      nextOrder = normalizeOrder({
        ...order,
        lines: order.lines.map((line) => (line.id === action.lineId ? { ...line, warehouseStatus: action.status } : line)),
        history: [buildEvent("almacen", `SKU ${updatedLine?.sku ?? action.lineId}: estado de almacen actualizado a ${action.status}.`, user.name), ...order.history]
      });
    }

    if (action.type === "updateLabelDevelopmentStatus") {
      const updatedLine = order.lines.find((line) => line.id === action.lineId);
      nextOrder = normalizeOrder({
        ...order,
        lines: order.lines.map((line) => (line.id === action.lineId ? { ...line, labelDevelopmentStatus: action.status } : line)),
        history: [
          buildEvent("elaboracion etiqueta", `SKU ${updatedLine?.sku ?? action.lineId}: estatus de elaboracion cambiado a ${action.status}.`, user.name),
          ...order.history
        ]
      });
    }

    if (action.type === "updateWarehouseLabelingStatus") {
      const updatedLine = order.lines.find((line) => line.id === action.lineId);
      nextOrder = normalizeOrder({
        ...order,
        lines: order.lines.map((line) => (line.id === action.lineId ? { ...line, warehouseLabelingStatus: action.status } : line)),
        history: [
          buildEvent("etiquetado almacen", `SKU ${updatedLine?.sku ?? action.lineId}: estatus de etiquetado cambiado a ${action.status}.`, user.name),
          ...order.history
        ]
      });
    }

    if (action.type === "addLabelRequirement") {
      const updatedLine = order.lines.find((line) => line.id === action.lineId);
      nextOrder = normalizeOrder({
        ...order,
        lines: order.lines.map((line) =>
          line.id === action.lineId ? { ...line, labelRequirements: [...(line.labelRequirements ?? []), action.requirement] } : line
        ),
        history: [
          buildEvent(
            "requerimiento etiqueta",
            `SKU ${updatedLine?.sku ?? action.lineId}: agregado ${action.requirement.quantity}x ${action.requirement.type} ${action.requirement.variant}.`,
            user.name
          ),
          ...order.history
        ]
      });
    }

    if (action.type === "deleteLabelRequirement") {
      const updatedLine = order.lines.find((line) => line.id === action.lineId);
      nextOrder = normalizeOrder({
        ...order,
        lines: order.lines.map((line) =>
          line.id === action.lineId
            ? { ...line, labelRequirements: (line.labelRequirements ?? []).filter((requirement) => requirement.id !== action.requirementId) }
            : line
        ),
        history: [buildEvent("requerimiento etiqueta", `SKU ${updatedLine?.sku ?? action.lineId}: requerimiento eliminado.`, user.name), ...order.history]
      });
    }

    if (action.type === "recordPrint") {
      const line = order.lines.find((candidate) => candidate.id === action.lineId);
      if (!line) throw new Error("Linea no encontrada para registrar impresion.");

      const record: PrintRecord = {
        id: uid("print"),
        at: new Date().toISOString(),
        user: user.name,
        orderId: order.id,
        lineId: line.id,
        sku: line.sku,
        quantity: Math.max(1, Number(action.quantity) || 1),
        labelType: action.labelType || "Etiqueta",
        labelSizeCode: action.labelSizeCode,
        labelSize: action.labelSize
      };

      nextOrder = normalizeOrder({
        ...order,
        lines: order.lines.map((candidate) =>
          candidate.id === action.lineId
            ? {
                ...candidate,
                warehouseStatus: candidate.warehouseStatus === "arrived_at_warehouse" ? candidate.warehouseStatus : "printed",
                warehouseLabelingStatus: candidate.warehouseLabelingStatus === "terminado" ? candidate.warehouseLabelingStatus : "impreso",
                printHistory: [record, ...(candidate.printHistory ?? [])]
              }
            : candidate
        ),
        history: [
          buildEvent(
            "impresion",
            `SKU ${line.sku}: ${record.quantity} ${record.labelType} ${record.labelSizeCode} (${record.labelSize}) impresas.`,
            user.name
          ),
          ...order.history
        ]
      });
    }

    if (action.type === "close") {
      nextOrder = normalizeOrder({
        ...order,
        status: "cerrado",
        labelingStatus: "completo",
        progress: 100,
        archived: true,
        closedAt: new Date().toISOString(),
        lines: order.lines.map((line) => ({ ...line, lineColor: "verde" })),
        files: order.files.map((file) => ({
          ...file,
          storageStatus: "conservado",
          preservedAt: file.preservedAt ?? new Date().toISOString()
        })),
        history: [buildEvent("cierre", "Pedido cerrado; links temporales conservados para el historico.", user.name), ...order.history]
      });
    }

    if (action.type === "restore") {
      nextOrder = normalizeOrder({
        ...order,
        status: order.status === "cerrado" ? "programado" : order.status,
        archived: false,
        closedAt: undefined,
        files: order.files.map((file) => ({ ...file, storageStatus: "temporal", preservedAt: undefined })),
        history: [buildEvent("reactivacion", "Pedido restaurado a la vista activa.", user.name), ...order.history]
      });
    }

    if (action.type === "addFile") {
      nextOrder = normalizeOrder({
        ...order,
        files: [
          {
            ...action.file,
            storageStatus: "temporal",
            addedAt: new Date().toISOString()
          },
          ...order.files
        ],
        history: [buildEvent("archivo temporal", `Link temporal agregado: ${action.file.name}.`, user.name), ...order.history]
      });
    }

    if (action.type === "updateFileSku") {
      const line = order.lines.find((candidate) => candidate.sku === action.sku);
      nextOrder = normalizeOrder({
        ...order,
        files: order.files.map((file) =>
          file.id === action.fileId
            ? {
                ...file,
                sku: action.sku || undefined,
                lineId: line?.id
              }
            : file
        ),
        history: [buildEvent("archivo sku", `Archivo asignado al SKU ${action.sku || "sin asignar"}.`, user.name), ...order.history]
      });
    }

    if (action.type === "updateFileMeta") {
      const target = order.files.find((file) => file.id === action.fileId);
      if (!target) throw new Error("Archivo no encontrado.");

      const nextSku = action.updates.sku !== undefined ? action.updates.sku : target.sku;
      const line = nextSku ? order.lines.find((candidate) => candidate.sku === nextSku) : undefined;
      const nextLabelSizeCode =
        action.updates.labelSizeCode !== undefined ? action.updates.labelSizeCode.toUpperCase() : target.labelSizeCode;
      const nextLabelSize =
        action.updates.labelSizeCode !== undefined ? labelSizeFromCode(nextLabelSizeCode) : action.updates.labelSize ?? target.labelSize;

      nextOrder = normalizeOrder({
        ...order,
        files: order.files.map((file) =>
          file.id === action.fileId
            ? {
                ...file,
                ...action.updates,
                name: action.updates.name?.trim() || file.name,
                sku: nextSku || undefined,
                lineId: nextSku ? line?.id : undefined,
                labelSizeCode: nextLabelSizeCode || undefined,
                labelSize: nextLabelSize || undefined,
                labelCategory:
                  action.updates.labelCategory !== undefined ? action.updates.labelCategory.trim() || undefined : file.labelCategory,
                labelVariant:
                  action.updates.labelVariant !== undefined ? action.updates.labelVariant.trim() || undefined : file.labelVariant,
                updatedAt: new Date().toISOString()
              }
            : file
        ),
        history: [buildEvent("archivo metadata", `Archivo actualizado: ${target.name}.`, user.name), ...order.history]
      });
    }

    if (action.type === "linkExistingResources") {
      const allOrders = readOrdersFromDatabase(database);
      const sourceOrder = action.sourceOrderId ? allOrders.find((candidate) => candidate.id === action.sourceOrderId) : undefined;
      const reusableFiles = findReusableFiles(order, allOrders, { sourceOrderId: action.sourceOrderId });
      nextOrder = normalizeOrder({
        ...order,
        files: [...reusableFiles, ...order.files],
        history: [
          buildEvent(
            "recursos",
            reusableFiles.length
              ? `${reusableFiles.length} archivo(s) existentes ligados por SKU desde ${sourceOrder?.code || "pedidos del mismo cliente"}.`
              : `No se encontraron recursos nuevos para los SKU del pedido en ${sourceOrder?.code || "pedidos del mismo cliente"}.`,
            user.name
          ),
          ...order.history
        ]
      });
    }

    if (action.type === "deleteFile") {
      const deletedFile = order.files.find((file) => file.id === action.fileId);
      nextOrder = normalizeOrder({
        ...order,
        files: order.files.filter((file) => file.id !== action.fileId),
        history: [buildEvent("archivo", `Archivo eliminado: ${deletedFile?.name ?? action.fileId}.`, user.name), ...order.history]
      });
    }

    if (action.type === "addLine") {
      nextOrder = normalizeOrder({
        ...order,
        lines: [...order.lines, action.line],
        columns: Array.from(new Set([...(order.columns ?? []), ...Object.keys(action.line.originalData ?? {})])),
        history: [buildEvent("linea", `Linea agregada para SKU ${action.line.sku}.`, user.name), ...order.history]
      });
    }

    if (action.type === "deleteLine") {
      const deletedSku = order.lines.find((line) => line.id === action.lineId)?.sku ?? "";
      nextOrder = normalizeOrder({
        ...order,
        lines: order.lines.filter((line) => line.id !== action.lineId),
        files: order.files.map((file) => (file.lineId === action.lineId ? { ...file, lineId: undefined, sku: undefined } : file)),
        history: [buildEvent("linea", `Linea eliminada para SKU ${deletedSku}.`, user.name), ...order.history]
      });
    }

    saveOrder(nextOrder);
  });
}

export async function addFilesToOrder(
  orderId: string,
  files: LinkedFile[],
  auth: AuthPayload,
  options: { overwriteExisting?: boolean; replaceFileId?: string; replaceBySyncIdentity?: boolean } = {}
) {
  const user = await authenticate(auth, "addFiles");
  let removedFiles: LinkedFile[] = [];

  const orders = await withWrite(async () => {
    const database = await openDb();
    const row = database.prepare("SELECT data FROM orders WHERE id = ?").get(orderId) as { data: string } | undefined;
    if (!row) throw new Error("Pedido no encontrado.");

    const order = rowToOrder(row);
    const removedFileIds = new Set<string>();

    if (options.replaceFileId) {
      for (const file of order.files) {
        if (file.id === options.replaceFileId) removedFileIds.add(file.id);
      }
    }

    if (options.replaceBySyncIdentity) {
      for (const file of order.files) {
        if (files.some((incoming) => sameSyncIdentity(file, incoming))) removedFileIds.add(file.id);
      }
    }

    if (options.overwriteExisting) {
      for (const file of order.files) {
        if (files.some((incoming) => fileMatchesReplacement(file, incoming))) removedFileIds.add(file.id);
      }
    }

    removedFiles = order.files.filter((file) => removedFileIds.has(file.id));

    const nextOrder = normalizeOrder({
      ...order,
      files: [
        ...files.map((file) => ({
          ...file,
          storageStatus: "temporal" as const,
          addedAt: new Date().toISOString()
        })),
        ...order.files.filter((file) => !removedFiles.some((removed) => removed.id === file.id))
      ],
      history: [
        buildEvent(
          "archivos",
          `${files.length} archivo(s) cargados${removedFiles.length ? `; ${removedFiles.length} reemplazado(s).` : " y relacionados automaticamente cuando fue posible."}`,
          user.name
        ),
        ...order.history
      ]
    });

    saveOrder(nextOrder);
  });

  return { orders, removedFiles };
}

export async function deleteFileFromOrder(orderId: string, fileId: string, auth: AuthPayload) {
  const user = await authenticate(auth, "deleteFile");
  let removedFile: LinkedFile | undefined;

  const orders = await withWrite(async () => {
    const database = await openDb();
    const row = database.prepare("SELECT data FROM orders WHERE id = ?").get(orderId) as { data: string } | undefined;
    if (!row) throw new Error("Pedido no encontrado.");

    const order = rowToOrder(row);
    removedFile = order.files.find((file) => file.id === fileId);
    if (!removedFile) throw new Error("Archivo no encontrado.");

    const nextOrder = normalizeOrder({
      ...order,
      files: order.files.filter((file) => file.id !== fileId),
      history: [buildEvent("archivo", `Archivo eliminado: ${removedFile.name}.`, user.name), ...order.history]
    });

    saveOrder(nextOrder);
  });

  return { orders, removedFile };
}

export async function clearFilesFromOrder(orderId: string, auth: AuthPayload) {
  const user = await authenticate(auth, "clearFiles");
  let removedFiles: LinkedFile[] = [];

  const orders = await withWrite(async () => {
    const database = await openDb();
    const row = database.prepare("SELECT data FROM orders WHERE id = ?").get(orderId) as { data: string } | undefined;
    if (!row) throw new Error("Pedido no encontrado.");

    const order = rowToOrder(row);
    removedFiles = order.files;
    const nextOrder = normalizeOrder({
      ...order,
      files: [],
      history: [buildEvent("archivos", `${removedFiles.length} archivo(s) eliminados del pedido.`, user.name), ...order.history]
    });

    saveOrder(nextOrder);
  });

  return { orders, removedFiles };
}
