import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sampleOrders } from "./sample-data";
import { dataDir, ensurePersistentStorage } from "./storage";
import { buildEvent, calculateLineProgress, lineColorLabels, normalizeOrder, statusFromLineProgress, uid } from "./order-utils";
import {
  AppUser,
  LabelDevelopmentStatus,
  LabelRequirement,
  LinkedFile,
  LineColor,
  Order,
  OrderLine,
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

function can(role: UserRole, action: string, field?: keyof Order) {
  if (role === "admin") return true;
  if (role === "consulta") return false;
  const isPlanning = role === "planning" || role === "planning_warehouse" || role === "planeacion";
  const isWarehouse = role === "planning_warehouse" || role === "etiquetado";

  if (action === "create" || action === "changeDispatchDate" || action === "close" || action === "restore") {
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

export async function addFilesToOrder(orderId: string, files: LinkedFile[], auth: AuthPayload, options: { overwriteExisting?: boolean } = {}) {
  const user = await authenticate(auth, "addFiles");
  let removedFiles: LinkedFile[] = [];

  const orders = await withWrite(async () => {
    const database = await openDb();
    const row = database.prepare("SELECT data FROM orders WHERE id = ?").get(orderId) as { data: string } | undefined;
    if (!row) throw new Error("Pedido no encontrado.");

    const order = rowToOrder(row);
    removedFiles = options.overwriteExisting
      ? order.files.filter((file) => files.some((incoming) => fileMatchesReplacement(file, incoming)))
      : [];

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
