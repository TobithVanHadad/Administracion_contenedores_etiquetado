"use client";

import {
  AlertTriangle,
  Archive,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  History,
  Link2,
  MessageCircle,
  PackageCheck,
  Paperclip,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Send,
  SlidersHorizontal,
  Trash2,
  Truck,
  Upload,
  Users
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { parseTableText } from "@/lib/importer";
import {
  ApprovalStatus,
  AppUser,
  ChatMessage,
  FileType,
  ImportPreviewRow,
  LabelDevelopmentStatus,
  LabelRequirement,
  LabelingStatus,
  LineColor,
  LinkedFile,
  Order,
  OrderDestination,
  OrderEstimate,
  OrderLine,
  OrderStatus,
  Priority,
  UserRole,
  WarehouseLabelingStatus,
  WarehouseStatus
} from "@/lib/types";

const USER_KEY = "orvel-pedidos-user";
const PIN_KEY = "orvel-pedidos-pin";
const HIDDEN_COLUMNS_KEY = "orvel-hidden-columns";
const DAILY_CAPACITY_HOURS = 16;
const APP_NAME = "Flip";

const statusLabels: Record<OrderStatus, string> = {
  importado: "Importado",
  validacion: "En validacion",
  pendiente_archivos: "Pendiente archivos",
  pendiente_aprobacion: "Pendiente aprobacion",
  aprobado: "Aprobado",
  etiquetando: "Etiquetando",
  etiquetado_completo: "Etiquetado completo",
  programado: "Programado",
  despachado: "Despachado",
  cerrado: "Cerrado"
};

const labelingLabels: Record<LabelingStatus, string> = {
  bloqueado: "Bloqueado",
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  completo: "Completo"
};

const approvalLabels: Record<ApprovalStatus, string> = {
  pendiente: "Pendiente",
  aprobado: "Aprobado",
  rechazado: "Rechazado"
};

const priorityLabels: Record<Priority, string> = {
  critica: "Critica",
  alta: "Alta",
  media: "Media",
  baja: "Baja"
};

const destinationLabels: Record<OrderDestination, string> = {
  mexico: "Mexico",
  usa: "Estados Unidos",
  europa: "Europa",
  otro: "Otro"
};

const roleLabels: Record<UserRole, string> = {
  admin: "Admin",
  planning: "Planning",
  planning_warehouse: "Planning/Warehouse",
  planeacion: "Planeacion",
  etiquetado: "Etiquetado",
  aprobador: "Aprobador",
  consulta: "Consulta"
};

const warehouseLabels: Record<WarehouseStatus, string> = {
  nothing_requested: "Nothing Requested",
  requested: "Requested",
  in_process: "In Process",
  printed: "Printed",
  sent_to_warehouse: "Sent to Warehouse",
  arrived_at_warehouse: "Arrived at Warehouse"
};

const labelDevelopmentLabels: Record<LabelDevelopmentStatus, string> = {
  no_ha_llegado: "No ha llegado",
  sintanxis: "Sintanxis",
  enviado_aprobacion: "Enviado a aprobacion",
  aprobado: "Aprobado",
  etiqueta_lista: "Etiqueta lista"
};

const warehouseLabelingLabels: Record<WarehouseLabelingStatus, string> = {
  no_iniciado: "No iniciado",
  impreso: "Impreso",
  etiquetando: "Etiquetando",
  terminado: "Terminado"
};

const labelDevelopmentProgress: Record<LabelDevelopmentStatus, number> = {
  no_ha_llegado: 0,
  sintanxis: 25,
  enviado_aprobacion: 50,
  aprobado: 75,
  etiqueta_lista: 100
};

const warehouseLabelingProgress: Record<WarehouseLabelingStatus, number> = {
  no_iniciado: 0,
  impreso: 35,
  etiquetando: 70,
  terminado: 100
};

const labelSizes = [
  { code: "L7", size: "6.4x3.8" },
  { code: "L6", size: "10.2x7.6" },
  { code: "L5", size: "3.0x2.2" },
  { code: "L4", size: "2.5x5.1" },
  { code: "L3", size: "7.0x7.0" },
  { code: "L2", size: "7.6x5.1" },
  { code: "L1", size: "6.3x5.1" }
];

const fileTypeLabels: Record<FileType, string> = {
  nlbl: "NiceLabel",
  btw: "BarTender",
  imagen: "Imagen",
  pdf: "PDF",
  drive: "Drive/OneDrive",
  otro: "Otro"
};

const defaultOrderColumns = [
  "CODE",
  "DRESCRIPTION",
  "PEDIDO",
  "INV",
  "P/CAJA",
  "CODIGO ETIQUETA",
  "CODIGO ETIQUETA CAJA",
  "CADUCIDAD",
  "WEIGHT",
  "TOTAL WEIGHT",
  "VOLUME",
  "TOTAL VOLUME",
  "CLAVE SAT",
  "TARIC CODE"
];

const lineColorLabels: Record<LineColor, string> = {
  sin_color: "Sin color",
  rojo: "Bloqueado",
  amarillo: "En proceso",
  azul: "Revision",
  verde: "Terminado"
};

type Tab = "pedidos" | "calendario" | "importar" | "historico" | "catalogo" | "biblioteca";

type ImportMeta = {
  code: string;
  customer: string;
  owner: string;
  destination: OrderDestination;
  priority: Priority;
  dispatchDate: string;
};

type FileDraft = {
  type: FileType;
  name: string;
  url: string;
};

type OrderSort = "priority" | "az" | "za" | "high_low" | "low_high" | "newest";

type LineSort = "az" | "za" | "high_low" | "low_high" | "newest";

type PrintDraft = {
  quantity: string;
  labelType: string;
  labelSizeCode: string;
};

type RequirementDraft = {
  quantity: string;
  type: string;
  variant: string;
  sizeCode: string;
};

type UploadFilesResponse = {
  orders: Order[];
  uploaded: LinkedFile[];
  rejected?: Array<{ name: string; reason: string }>;
  replaced?: LinkedFile[];
};

type UploadFeedback = {
  message: string;
  tone: "neutral" | "success" | "warning" | "error";
};

type FileMetadataUpdate = Partial<
  Pick<LinkedFile, "type" | "name" | "sku" | "labelSizeCode" | "labelSize" | "labelCategory" | "labelVariant">
>;

type UploadCandidate = {
  file: File;
  sku?: string;
  type: FileType;
  labelSizeCode?: string;
  labelCategory?: string;
};

type FileLibraryItem = {
  order: Order;
  file: LinkedFile;
  line?: OrderLine;
};

type OperationalColumnId = "__status_color" | "__label_dev" | "__warehouse_labeling" | "__requirements" | "__suggested" | "__files" | "__print" | "__actions";

type TableColumnDef = {
  id: string;
  label: string;
  kind: "operational" | "data";
};

const operationalLineColumns: Array<TableColumnDef & { id: OperationalColumnId }> = [
  { id: "__status_color", label: "Color", kind: "operational" },
  { id: "__label_dev", label: "Elaboracion etiquetas", kind: "operational" },
  { id: "__warehouse_labeling", label: "Etiquetado / almacen", kind: "operational" },
  { id: "__requirements", label: "Etiquetas requeridas", kind: "operational" },
  { id: "__suggested", label: "Multiplicacion sugerida", kind: "operational" },
  { id: "__files", label: "Archivos", kind: "operational" },
  { id: "__print", label: "Print Tracking", kind: "operational" },
  { id: "__actions", label: "Acciones", kind: "operational" }
];

const uploadBatchMaxFiles = 8;
const uploadBatchMaxBytes = 6 * 1024 * 1024;

const defaultImportMeta: ImportMeta = {
  code: "",
  customer: "",
  owner: "Operaciones MX",
  destination: "mexico",
  priority: "media",
  dispatchDate: todayString()
};

const defaultFileDraft: FileDraft = {
  type: "drive",
  name: "",
  url: ""
};

function uid(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, amount: number) {
  const base = new Date(`${date}T12:00:00`);
  base.setDate(base.getDate() + amount);
  return base.toISOString().slice(0, 10);
}

function addMonths(date: string, amount: number) {
  const base = new Date(`${date}T12:00:00`);
  base.setMonth(base.getMonth() + amount);
  return base.toISOString().slice(0, 10);
}

function startOfMonth(date: string) {
  const base = new Date(`${date}T12:00:00`);
  return new Date(base.getFullYear(), base.getMonth(), 1).toISOString().slice(0, 10);
}

function monthTitle(date: string) {
  return new Intl.DateTimeFormat("es-MX", {
    month: "long",
    year: "numeric"
  }).format(new Date(`${date.slice(0, 10)}T12:00:00`));
}

function formatDate(date?: string) {
  if (!date) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(`${date.slice(0, 10)}T12:00:00`));
}

function formatDateTime(date: string) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(date));
}

function formatFileSize(size?: number) {
  if (!size) return "Tamano N/D";
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function isLate(order: Order) {
  return !order.archived && order.dispatchDate < todayString() && order.status !== "despachado";
}

function calculateEstimate(lines: OrderLine[]): OrderEstimate {
  return calculateDetailedEstimate(lines);
}

function calculateDetailedEstimate(lines: OrderLine[], config = { labelMinutesPerLabel: 15, warehouseUnitsPerPersonPerDay: 2000, basePeople: 5, tempPeople: 0 }): OrderEstimate {
  const totalQuantity = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  const skuCount = new Set(lines.map((line) => line.sku).filter(Boolean)).size;
  const missingLabels = lines.filter((line) => !line.labelCode || !line.caseLabelCode).length;
  const estimatedHours = Math.max(1, skuCount * 0.45 + totalQuantity * 0.06 + missingLabels * 0.8);
  const estimatedDays = Math.max(1, Math.ceil(estimatedHours / DAILY_CAPACITY_HOURS));
  const labelCount = Math.max(
    0,
    lines.reduce((sum, line) => sum + getLineLabelCount(line), 0)
  );
  const labelDesignHours = Math.max(0, (labelCount * config.labelMinutesPerLabel) / 60);
  const labelDesignDays = labelDesignHours === 0 ? 0 : Math.max(1, Math.ceil(labelDesignHours / DAILY_CAPACITY_HOURS));
  const warehousePeople = Math.max(1, config.basePeople + config.tempPeople);
  const warehouseDailyCapacity = Math.max(1, warehousePeople * config.warehouseUnitsPerPersonPerDay);
  const warehouseDays = totalQuantity === 0 ? 0 : Math.max(1, Math.ceil(totalQuantity / warehouseDailyCapacity));

  return {
    totalQuantity,
    skuCount,
    missingLabels,
    estimatedHours,
    estimatedDays,
    labelCount,
    labelDesignHours,
    labelDesignDays,
    warehousePeople,
    warehouseDays
  };
}

function getLineColor(line: OrderLine): LineColor {
  const status = getLabelDevelopmentStatus(line);
  if (status === "etiqueta_lista") return "verde";
  if (status === "aprobado" || status === "enviado_aprobacion") return "azul";
  if (status === "sintanxis") return "amarillo";
  if (status === "no_ha_llegado") return "rojo";
  return "sin_color";
}

function getLabelDevelopmentStatus(line: OrderLine): LabelDevelopmentStatus {
  return line.labelDevelopmentStatus ?? "no_ha_llegado";
}

function getWarehouseLabelingStatus(line: OrderLine): WarehouseLabelingStatus {
  return line.warehouseLabelingStatus ?? "no_iniciado";
}

function getLineLabelCount(line: OrderLine) {
  const explicitCount = (line.labelRequirements ?? []).reduce((sum, requirement) => sum + (Number(requirement.quantity) || 0), 0);
  if (explicitCount > 0) return explicitCount;
  return [line.labelCode, line.caseLabelCode].filter((value) => value && String(value).trim()).length;
}

function averageProgress(lines: OrderLine[], getter: (line: OrderLine) => number) {
  if (lines.length === 0) return 0;
  return Math.round(lines.reduce((sum, line) => sum + getter(line), 0) / lines.length);
}

function calculateLineProgress(lines: OrderLine[]) {
  const total = lines.length;
  const completed = lines.filter((line) => getLineColor(line) === "verde").length;
  const progress = total === 0 ? 0 : Math.round((completed / total) * 100);

  return { completed, total, progress };
}

function normalizeOperationalValue(value?: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeColumnName(column: string) {
  return column
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isSkuColumn(column: string) {
  const normalized = normalizeColumnName(column);
  return normalized === "code" || normalized === "sku";
}

function isDescriptionColumn(column: string) {
  const normalized = normalizeColumnName(column);
  return normalized.includes("description") || normalized.includes("drescription") || normalized.includes("descripcion");
}

function rowsForDescription(value: string) {
  return Math.min(4, Math.max(2, Math.ceil(value.length / 30)));
}

function numberFromValue(value: unknown) {
  const numeric = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? numeric : undefined;
}

function suggestedPiecesForLine(line: OrderLine) {
  const pedido = numberFromValue(line.quantity ?? line.originalData?.PEDIDO);
  const piecesPerCase =
    numberFromValue(line.piecesPerCase) ??
    numberFromValue(line.originalData?.["P/CAJA"]) ??
    numberFromValue(line.originalData?.["PZA/CAJA"]) ??
    numberFromValue(line.originalData?.["PIEZAS CAJA"]);

  if (!pedido || !piecesPerCase) return undefined;
  return {
    pedido,
    piecesPerCase,
    total: pedido * piecesPerCase
  };
}

function isBlockingValue(value?: string) {
  const normalized = normalizeOperationalValue(value);
  return !normalized || normalized === "0" || normalized === "n/a" || normalized.includes("#n/a") || normalized.includes("#error");
}

function needsReviewValue(value?: string) {
  const normalized = normalizeOperationalValue(value);
  return normalized.includes("revisar") || normalized.includes("new product");
}

function inferInitialLineColor(row: ImportPreviewRow): LineColor {
  if (isBlockingValue(row.labelCode)) return "rojo";
  if (needsReviewValue(row.labelCode) || needsReviewValue(row.caseLabelCode) || needsReviewValue(row.taricCode)) return "azul";
  if (isBlockingValue(row.caseLabelCode)) return "amarillo";
  return "sin_color";
}

function lineValueForColumn(line: OrderLine, column: string): string {
  const raw = line.originalData?.[column];
  if (raw !== undefined && raw !== null && raw !== "") return String(raw);

  const normalized = normalizeColumnName(column);
  if (isSkuColumn(column)) return line.sku;
  if (isDescriptionColumn(column)) return line.description;
  if (normalized === "pedido" || normalized.includes("cantidad")) return String(line.quantity);
  if (normalized.includes("p/caja")) return String(line.piecesPerCase ?? "");
  if (normalized.includes("codigo etiqueta caja")) return line.caseLabelCode ?? "";
  if (normalized.includes("codigo etiqueta")) return line.labelCode ?? "";
  if (normalized.includes("caducidad")) return line.expirationDate ?? "";
  if (normalized === "weight") return String(line.weightKg ?? "");
  if (normalized === "volume") return String(line.volumeM3 ?? "");
  if (normalized.includes("sat")) return line.satCode ?? "";
  if (normalized.includes("taric")) return line.taricCode ?? "";
  return "";
}

function getMonthGridDays(monthDate: string) {
  const monthStart = startOfMonth(monthDate);
  const first = new Date(`${monthStart}T12:00:00`);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = addDays(monthStart, -mondayOffset);

  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function sumWeight(lines: OrderLine[]) {
  return lines.reduce((sum, line) => sum + (line.weightKg ?? 0) * (line.quantity || 0), 0);
}

function sumVolume(lines: OrderLine[]) {
  return lines.reduce((sum, line) => sum + (line.volumeM3 ?? 0) * (line.quantity || 0), 0);
}

function buildEvent(type: string, message: string) {
  return {
    id: uid("evt"),
    at: new Date().toISOString(),
    user: "Operaciones",
    type,
    message
  };
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function priorityRank(priority: Priority) {
  return { critica: 4, alta: 3, media: 2, baja: 1 }[priority];
}

function getWarehouseStatus(line: OrderLine): WarehouseStatus {
  return line.warehouseStatus ?? "nothing_requested";
}

function getOrderPlanningConfig(order: Order) {
  return {
    labelMinutesPerLabel: order.planningConfig?.labelMinutesPerLabel ?? 15,
    warehouseUnitsPerPersonPerDay: order.planningConfig?.warehouseUnitsPerPersonPerDay ?? 2000,
    basePeople: order.planningConfig?.basePeople ?? 5,
    tempPeople: order.planningConfig?.tempPeople ?? 0
  };
}

function lastPrintAt(line: OrderLine) {
  return line.printHistory?.[0]?.at ?? "";
}

function orderUserHaystack(order: Order) {
  const printUsers = order.lines.flatMap((line) => line.printHistory ?? []).map((record) => record.user);
  const historyUsers = order.history.map((event) => event.user);
  return normalizeText([order.owner, ...historyUsers, ...printUsers].join(" "));
}

function orderHasDate(order: Order, date: string) {
  if (!date) return true;
  return (
    order.dispatchDate === date ||
    order.createdAt.slice(0, 10) === date ||
    order.closedAt?.slice(0, 10) === date ||
    order.history.some((event) => event.at.slice(0, 10) === date) ||
    order.lines.some((line) => line.printHistory?.some((record) => record.at.slice(0, 10) === date))
  );
}

function compareOrdersBySort(a: Order, b: Order, sortMode: OrderSort) {
  if (sortMode === "az") return a.code.localeCompare(b.code);
  if (sortMode === "za") return b.code.localeCompare(a.code);
  if (sortMode === "high_low") return priorityRank(b.priority) - priorityRank(a.priority) || b.lines.length - a.lines.length;
  if (sortMode === "low_high") return priorityRank(a.priority) - priorityRank(b.priority) || a.lines.length - b.lines.length;
  if (sortMode === "newest") return b.createdAt.localeCompare(a.createdAt);
  return priorityRank(b.priority) - priorityRank(a.priority) || a.dispatchDate.localeCompare(b.dispatchDate);
}

function compareLinesBySort(a: OrderLine, b: OrderLine, sortMode: LineSort) {
  if (sortMode === "az") return a.sku.localeCompare(b.sku);
  if (sortMode === "za") return b.sku.localeCompare(a.sku);
  if (sortMode === "high_low") return (Number(b.quantity) || 0) - (Number(a.quantity) || 0);
  if (sortMode === "low_high") return (Number(a.quantity) || 0) - (Number(b.quantity) || 0);
  if (sortMode === "newest") return lastPrintAt(b).localeCompare(lastPrintAt(a));
  return 0;
}

function summarizeRejectedFiles(rejected: Array<{ name: string; reason: string }> = []) {
  const names = rejected.slice(0, 3).map((file) => file.name).join(", ");
  if (!names) return "";
  return rejected.length > 3 ? `${names} y ${rejected.length - 3} mas` : names;
}

function buildUploadBatches(files: File[]) {
  const batches: File[][] = [];
  let currentBatch: File[] = [];
  let currentSize = 0;

  for (const file of files) {
    const wouldOverflow =
      currentBatch.length > 0 &&
      (currentBatch.length >= uploadBatchMaxFiles || currentSize + file.size > uploadBatchMaxBytes);

    if (wouldOverflow) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }

    currentBatch.push(file);
    currentSize += file.size;
  }

  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
}

function uploadErrorMessage(error: unknown) {
  if (error instanceof Error && error.message === "Failed to fetch") {
    return "No se pudo conectar con el servidor durante la subida. La app intentara evitar esto subiendo en lotes mas pequenos.";
  }

  return error instanceof Error ? error.message : "No se pudieron subir archivos.";
}

function fileTypeFromName(name: string): FileType {
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith(".nlbl")) return "nlbl";
  if (lowerName.endsWith(".btw")) return "btw";
  if (lowerName.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g|webp|gif)$/i.test(lowerName)) return "imagen";
  return "otro";
}

function detectLabelSizeCodeFromName(name: string) {
  const match = name.toUpperCase().match(/(?:^|[^A-Z0-9])(L[1-7])(?:[^0-9]|$)/);
  return match?.[1];
}

function labelSizeValue(code?: string) {
  return labelSizes.find((size) => size.code === code)?.size;
}

function detectLabelCategoryFromName(name: string, type: FileType) {
  const normalized = normalizeText(name);
  if (normalized.includes("caja") || normalized.includes("case") || normalized.includes("carton")) return "Caja";
  if (normalized.includes("producto") || normalized.includes("product")) return "Producto";
  if (normalized.includes("orden") || normalized.includes("order")) return "Orden";
  if (type === "btw" || type === "nlbl") return "Etiqueta";
  if (type === "pdf") return "PDF";
  if (type === "imagen") return "Imagen";
  return "General";
}

function buildUploadCandidate(file: File, order: Order): UploadCandidate {
  const type = fileTypeFromName(file.name);
  const skus = order.lines.map((line) => line.sku).sort((a, b) => b.length - a.length);
  const normalizedName = normalizeText(file.name);
  const sku = skus.find((candidate) => candidate && normalizedName.includes(normalizeText(candidate)));
  const labelSizeCode = detectLabelSizeCodeFromName(file.name);

  return {
    file,
    sku,
    type,
    labelSizeCode,
    labelCategory: detectLabelCategoryFromName(file.name, type)
  };
}

function fileMatchesUploadCandidate(existing: LinkedFile, candidate: UploadCandidate) {
  if (!existing.sku || !candidate.sku || existing.sku !== candidate.sku) return false;
  if (existing.type !== candidate.type) return false;

  const sameName = normalizeText(existing.originalName || existing.name) === normalizeText(candidate.file.name);
  const sameLabelSize = Boolean(candidate.labelSizeCode && existing.labelSizeCode === candidate.labelSizeCode);
  const sameCategory = normalizeText(existing.labelCategory || "") === normalizeText(candidate.labelCategory || "");

  return sameName || (sameLabelSize && sameCategory);
}

function buildFileLibraryItems(orders: Order[]): FileLibraryItem[] {
  return orders.flatMap((order) =>
    order.files.map((file) => ({
      order,
      file,
      line: order.lines.find((line) => line.id === file.lineId || line.sku === file.sku)
    }))
  );
}

function fileLibraryHaystack(item: FileLibraryItem) {
  return normalizeText(
    [
      item.file.name,
      item.file.originalName,
      item.file.sku,
      item.file.type,
      item.file.labelCategory,
      item.file.labelVariant,
      item.file.labelSizeCode,
      item.order.code,
      item.order.customer,
      item.line?.description
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function groupFileLibraryItems(items: FileLibraryItem[]) {
  return Object.entries(fileTypeLabels)
    .map(([type, label]) => ({
      type: type as FileType,
      label,
      items: items.filter((item) => item.file.type === type)
    }))
    .filter((group) => group.items.length > 0);
}

function isStoredCatalogItem(item: FileLibraryItem) {
  return Boolean(item.file.storedName || item.file.sourceOrderId || item.file.storageStatus === "conservado" || item.order.archived);
}

export default function Home() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncMessage, setSyncMessage] = useState("Conectando al servidor...");
  const [currentUser, setCurrentUser] = useState("Gloria");
  const [currentPin, setCurrentPin] = useState("");
  const [loggedInUser, setLoggedInUser] = useState("");
  const [loginMessage, setLoginMessage] = useState("Acceso pendiente");
  const [loginLoading, setLoginLoading] = useState(false);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("pedidos");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [query, setQuery] = useState("");
  const [calendarStart, setCalendarStart] = useState(todayString());
  const [importText, setImportText] = useState("");
  const [importMeta, setImportMeta] = useState<ImportMeta>(defaultImportMeta);
  const [previewRows, setPreviewRows] = useState<ImportPreviewRow[]>([]);
  const [importMessage, setImportMessage] = useState("");
  const [replaceExistingOrder, setReplaceExistingOrder] = useState(true);
  const [fileDraft, setFileDraft] = useState<FileDraft>(defaultFileDraft);
  const [fileUploadFeedback, setFileUploadFeedback] = useState<Record<string, UploadFeedback>>({});
  const [hiddenColumnsByOrder, setHiddenColumnsByOrder] = useState<Record<string, string[]>>({});
  const [orderSort, setOrderSort] = useState<OrderSort>("priority");
  const [userFilter, setUserFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatDirectTo, setChatDirectTo] = useState("");
  const [chatStatus, setChatStatus] = useState("Chat listo");
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("default");
  const lastChatMessageId = useRef<string>("");

  useEffect(() => {
    const savedUser = window.localStorage.getItem(USER_KEY);
    const savedPin = window.localStorage.getItem(PIN_KEY);
    const savedColumns = window.localStorage.getItem(HIDDEN_COLUMNS_KEY);
    if (savedUser) setCurrentUser(savedUser === "Amira" || savedUser === "Diana" ? "Gloria" : savedUser);
    if (savedPin) setCurrentPin(savedPin);
    if (savedColumns) {
      try {
        setHiddenColumnsByOrder(JSON.parse(savedColumns) as Record<string, string[]>);
      } catch {
        setHiddenColumnsByOrder({});
      }
    }
    void loadOrders(true);

    const interval = window.setInterval(() => {
      void loadOrders(false);
    }, 5000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(USER_KEY, currentUser);
  }, [currentUser]);

  useEffect(() => {
    window.localStorage.setItem(PIN_KEY, currentPin);
  }, [currentPin]);

  useEffect(() => {
    setLoggedInUser("");
    setLoginMessage("Acceso pendiente");
  }, [currentPin, currentUser]);

  useEffect(() => {
    window.localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(hiddenColumnsByOrder));
  }, [hiddenColumnsByOrder]);

  useEffect(() => {
    if ("Notification" in window) setNotificationPermission(window.Notification.permission);
  }, []);

  useEffect(() => {
    if (!loggedInUser) return;
    void loadChatMessages(false);
    const interval = window.setInterval(() => {
      void loadChatMessages(true);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [loggedInUser, currentUser]);

  async function loadOrders(initial = false) {
    try {
      const response = await fetch("/api/orders", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { orders?: Order[]; users?: AppUser[]; error?: string };
      if (!response.ok || !data.orders) throw new Error(data.error || "No se pudo leer la API de pedidos.");
      const nextOrders = data.orders;
      const nextUsers = data.users;
      setOrders(nextOrders);
      if (nextUsers) {
        setUsers(nextUsers);
        setCurrentUser((current) => (nextUsers.some((user) => user.name === current) ? current : nextUsers[0]?.name || current));
      }
      setSelectedOrderId((current) => current || nextOrders.find((order) => !order.archived)?.id || nextOrders[0]?.id || "");
      setSyncMessage("Datos sincronizados");
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "Sin conexion con el servidor de pedidos");
    } finally {
      if (initial) setLoading(false);
    }
  }

  async function loadChatMessages(allowNotification: boolean) {
    try {
      const response = await fetch(`/api/chat?user=${encodeURIComponent(currentUser)}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { messages?: ChatMessage[]; error?: string };
      if (!response.ok || !data.messages) throw new Error(data.error || "No se pudo leer el chat.");

      const latest = data.messages[data.messages.length - 1];
      const previousLatestId = lastChatMessageId.current;
      setChatMessages(data.messages);
      if (latest) lastChatMessageId.current = latest.id;

      if (
        allowNotification &&
        latest &&
        previousLatestId &&
        latest.id !== previousLatestId &&
        latest.user !== currentUser &&
        "Notification" in window &&
        window.Notification.permission === "granted"
      ) {
        new window.Notification(`Flip - ${latest.user}`, {
          body: latest.body,
          icon: "/flip-icon.svg"
        });
      }
    } catch (error) {
      setChatStatus(error instanceof Error ? error.message : "No se pudo leer el chat.");
    }
  }

  async function sendChatMessage() {
    const body = chatDraft.trim();
    if (!body) return;

    setChatStatus("Enviando...");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: currentUser, pin: currentPin, body, directTo: chatDirectTo || undefined })
      });
      const data = (await response.json().catch(() => ({}))) as { messages?: ChatMessage[]; error?: string };
      if (!response.ok || !data.messages) throw new Error(data.error || "No se pudo enviar el mensaje.");

      setChatMessages(data.messages);
      lastChatMessageId.current = data.messages[data.messages.length - 1]?.id ?? lastChatMessageId.current;
      setChatDraft("");
      setChatStatus("Mensaje enviado");
    } catch (error) {
      setChatStatus(error instanceof Error ? error.message : "No se pudo enviar el mensaje.");
    }
  }

  async function requestChatNotifications() {
    if (!("Notification" in window)) {
      setChatStatus("Este navegador no soporta notificaciones.");
      return;
    }

    const permission = await window.Notification.requestPermission();
    setNotificationPermission(permission);
    setChatStatus(permission === "granted" ? "Notificaciones activadas" : "Notificaciones no activadas");
  }

  async function applyServerOrders(request: Promise<Response>, successMessage: string) {
    setSyncMessage("Guardando cambios...");
    try {
      const response = await request;
      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorData.error || "La API rechazo el cambio.");
      }
      const data = (await response.json()) as { orders: Order[] };
      setOrders(data.orders);
      setSyncMessage(successMessage);
      return data.orders;
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "No se pudo guardar. Revisa que el servidor este activo.");
      return orders;
    }
  }

  async function handleLogin() {
    setLoginLoading(true);
    setLoginMessage("Validando acceso...");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: currentUser || "Operaciones", pin: currentPin })
      });

      const data = (await response.json().catch(() => ({}))) as { user?: AppUser; error?: string };
      if (!response.ok || !data.user) throw new Error(data.error || "No se pudo validar el acceso.");

      setLoggedInUser(data.user.name);
      setLoginMessage(`Acceso confirmado: ${data.user.name}`);
      setSyncMessage(`Acceso confirmado: ${data.user.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo validar el acceso.";
      setLoggedInUser("");
      setLoginMessage(message);
      setSyncMessage(message);
    } finally {
      setLoginLoading(false);
    }
  }

  const activeOrders = useMemo(
    () =>
      orders
        .filter((order) => !order.archived)
        .sort((a, b) => compareOrdersBySort(a, b, orderSort)),
    [orders, orderSort]
  );

  const archivedOrders = useMemo(
    () => orders.filter((order) => order.archived).sort((a, b) => b.dispatchDate.localeCompare(a.dispatchDate)),
    [orders]
  );

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) ?? activeOrders[0] ?? orders[0],
    [activeOrders, orders, selectedOrderId]
  );

  const filteredActiveOrders = useMemo(() => {
    const needle = normalizeText(query);
    return activeOrders.filter((order) =>
      (!needle ||
        normalizeText(
          `${order.code} ${order.customer} ${order.owner} ${order.status} ${order.priority} ${order.lines
            .map((line) => `${line.sku} ${line.description}`)
            .join(" ")}`
        ).includes(needle)) &&
      (!userFilter || orderUserHaystack(order).includes(normalizeText(userFilter))) &&
      (!statusFilter ||
        order.status === statusFilter ||
        order.labelingStatus === statusFilter ||
        order.approvalStatus === statusFilter ||
        order.lines.some(
          (line) =>
            getWarehouseStatus(line) === statusFilter ||
            getLabelDevelopmentStatus(line) === statusFilter ||
            getWarehouseLabelingStatus(line) === statusFilter
        )) &&
      orderHasDate(order, dateFilter)
    );
  }, [activeOrders, dateFilter, query, statusFilter, userFilter]);

  const metrics = useMemo(() => {
    const late = activeOrders.filter(isLate).length;
    const blocked = activeOrders.filter(
      (order) => order.labelingStatus === "bloqueado" || order.approvalStatus === "rechazado"
    ).length;
    const labelProgress = averageProgress(activeOrders.flatMap((order) => order.lines), (line) => labelDevelopmentProgress[getLabelDevelopmentStatus(line)]);
    const warehouseProgress = averageProgress(activeOrders.flatMap((order) => order.lines), (line) => warehouseLabelingProgress[getWarehouseLabelingStatus(line)]);
    const workload = activeOrders.reduce((sum, order) => sum + calculateDetailedEstimate(order.lines, getOrderPlanningConfig(order)).labelDesignHours!, 0);
    const warehouseDays = activeOrders.reduce((sum, order) => sum + calculateDetailedEstimate(order.lines, getOrderPlanningConfig(order)).warehouseDays!, 0);
    const nextDispatch = activeOrders
      .filter((order) => order.dispatchDate >= todayString())
      .sort((a, b) => a.dispatchDate.localeCompare(b.dispatchDate))[0];

    return {
      active: activeOrders.length,
      late,
      blocked,
      labelProgress,
      warehouseProgress,
      workload,
      warehouseDays,
      nextDispatch
    };
  }, [activeOrders]);

  function patchOrder(orderId: string, payload: Record<string, unknown>, successMessage: string) {
    return applyServerOrders(
      fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, ...payload, user: currentUser || "Operaciones", pin: currentPin })
      }),
      successMessage
    );
  }

  function updateOrderField<K extends keyof Order>(orderId: string, field: K, value: Order[K], label: string) {
    void patchOrder(orderId, { type: "updateField", field, value, label }, "Campo actualizado");
  }

  function changeDispatchDate(orderId: string, nextDate: string) {
    void patchOrder(orderId, { type: "changeDispatchDate", nextDate }, "Fecha de despacho actualizada");
  }

  function updateLineColor(orderId: string, lineId: string, color: LineColor) {
    void patchOrder(orderId, { type: "updateLineColor", lineId, color }, "Avance actualizado");
  }

  function updateLineVisibility(orderId: string, lineId: string, hidden: boolean) {
    void patchOrder(orderId, { type: "updateLineVisibility", lineId, hidden }, hidden ? "Fila oculta" : "Fila visible");
  }

  function updateFileSku(orderId: string, fileId: string, sku: string) {
    void patchOrder(orderId, { type: "updateFileSku", fileId, sku }, "Archivo asignado a SKU");
  }

  function updateFileMeta(orderId: string, fileId: string, updates: FileMetadataUpdate) {
    const nextUpdates = { ...updates };
    if (nextUpdates.labelSizeCode) {
      nextUpdates.labelSize = labelSizeValue(nextUpdates.labelSizeCode);
    }
    void patchOrder(orderId, { type: "updateFileMeta", fileId, updates: nextUpdates }, "Archivo actualizado");
  }

  async function linkExistingResources(orderId: string, sourceOrderId?: string) {
    const beforeCount = orders.find((order) => order.id === orderId)?.files.length ?? 0;
    const sourceOrder = orders.find((order) => order.id === sourceOrderId);
    const nextOrders = await patchOrder(orderId, { type: "linkExistingResources", sourceOrderId }, "Recursos detectados");
    const afterCount = nextOrders.find((order) => order.id === orderId)?.files.length ?? beforeCount;
    const linkedCount = Math.max(0, afterCount - beforeCount);

    setFileUploadFeedback((current) => ({
      ...current,
      [orderId]: {
        message: linkedCount
          ? `${linkedCount} recurso(s) existentes ligados por SKU desde ${sourceOrder?.code || "pedidos del mismo cliente"}.`
          : `No encontre recursos nuevos para los SKU de este pedido en ${sourceOrder?.code || "pedidos del mismo cliente"}.`,
        tone: linkedCount ? "success" : "warning"
      }
    }));
  }

  async function clearOrderFiles(orderId: string) {
    const beforeCount = orders.find((order) => order.id === orderId)?.files.length ?? 0;
    const nextOrders = await applyServerOrders(
      fetch("/api/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, clearAll: true, user: currentUser || "Operaciones", pin: currentPin })
      }),
      "Archivos eliminados"
    );
    const afterCount = nextOrders.find((order) => order.id === orderId)?.files.length ?? 0;
    const removedCount = Math.max(0, beforeCount - afterCount);

    setFileUploadFeedback((current) => ({
      ...current,
      [orderId]: {
        message: `${removedCount} archivo(s) eliminados de este pedido.`,
        tone: removedCount ? "success" : "warning"
      }
    }));
  }

  function deleteFile(orderId: string, fileId: string) {
    void applyServerOrders(
      fetch("/api/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, fileId, user: currentUser || "Operaciones", pin: currentPin })
      }),
      "Archivo eliminado"
    );
  }

  async function replaceFile(orderId: string, file: LinkedFile, files: FileList | null) {
    const replacement = files?.[0];
    if (!replacement) return;

    if (!file.sku) {
      setSyncMessage("Asigna un SKU al archivo antes de reemplazarlo.");
      return;
    }

    const replacementType = file.type === "drive" ? fileTypeFromName(replacement.name) : file.type;
    const labelSizeCode = file.labelSizeCode || detectLabelSizeCodeFromName(replacement.name);
    const formData = new FormData();
    formData.append("orderId", orderId);
    formData.append("user", currentUser || "Operaciones");
    formData.append("pin", currentPin);
    formData.append("overwriteExisting", "1");
    formData.append("replaceFileId", file.id);
    formData.append(
      "fileMetadata",
      JSON.stringify([
        {
          type: replacementType,
          sku: file.sku,
          labelSizeCode,
          labelSize: labelSizeValue(labelSizeCode),
          labelCategory: file.labelCategory || detectLabelCategoryFromName(replacement.name, replacementType),
          labelVariant: file.labelVariant,
          name: file.name,
          originalName: replacement.name
        }
      ])
    );
    formData.append("files", replacement);
    setSyncMessage(`Reemplazando ${file.name}...`);

    try {
      const response = await fetch("/api/files", {
        method: "POST",
        body: formData
      });
      const data = (await response.json().catch(() => ({}))) as Partial<UploadFilesResponse> & { error?: string };
      if (!response.ok || !data.orders) throw new Error(data.error || "No se pudo reemplazar el archivo.");

      setOrders(data.orders);
      const uploadedCount = data.uploaded?.length ?? 0;
      const rejectedSummary = summarizeRejectedFiles(data.rejected ?? []);
      const message =
        uploadedCount > 0
          ? `Archivo reemplazado: ${file.name}.`
          : `No se reemplazo el archivo${rejectedSummary ? `: ${rejectedSummary}` : "."}`;
      setSyncMessage(message);
      setFileUploadFeedback((current) => ({
        ...current,
        [orderId]: { message, tone: uploadedCount > 0 ? "success" : "error" }
      }));
    } catch (error) {
      const message = uploadErrorMessage(error);
      setSyncMessage(message);
      setFileUploadFeedback((current) => ({
        ...current,
        [orderId]: { message, tone: "error" }
      }));
    }
  }

  function updateLineCell(orderId: string, lineId: string, column: string, value: string) {
    void patchOrder(orderId, { type: "updateLineCell", lineId, column, value }, "Celda actualizada");
  }

  function updateWarehouseStatus(orderId: string, lineId: string, status: WarehouseStatus) {
    void patchOrder(orderId, { type: "updateWarehouseStatus", lineId, status }, "Estado de almacen actualizado");
  }

  function updateLabelDevelopmentStatus(orderId: string, lineId: string, status: LabelDevelopmentStatus) {
    void patchOrder(orderId, { type: "updateLabelDevelopmentStatus", lineId, status }, "Estado de elaboracion actualizado");
  }

  function updateWarehouseLabelingStatus(orderId: string, lineId: string, status: WarehouseLabelingStatus) {
    void patchOrder(orderId, { type: "updateWarehouseLabelingStatus", lineId, status }, "Estado de etiquetado actualizado");
  }

  function addLabelRequirement(orderId: string, lineId: string, requirement: LabelRequirement) {
    void patchOrder(orderId, { type: "addLabelRequirement", lineId, requirement }, "Requerimiento de etiqueta agregado");
  }

  function deleteLabelRequirement(orderId: string, lineId: string, requirementId: string) {
    void patchOrder(orderId, { type: "deleteLabelRequirement", lineId, requirementId }, "Requerimiento de etiqueta eliminado");
  }

  function recordPrint(orderId: string, lineId: string, draft: PrintDraft) {
    const labelSize = labelSizes.find((size) => size.code === draft.labelSizeCode) ?? labelSizes[0];
    void patchOrder(
      orderId,
      {
        type: "recordPrint",
        lineId,
        quantity: Number(draft.quantity) || 0,
        labelType: draft.labelType.trim() || "Etiqueta",
        labelSizeCode: labelSize.code,
        labelSize: labelSize.size
      },
      "Impresion registrada"
    );
  }

  function addLine(orderId: string, line: OrderLine) {
    void patchOrder(orderId, { type: "addLine", line }, "Linea agregada");
  }

  function deleteLine(orderId: string, lineId: string) {
    void patchOrder(orderId, { type: "deleteLine", lineId }, "Linea eliminada");
  }

  function exportOrders() {
    const headers = [
      "Pedido",
      "Cliente",
      "SKU",
      "Descripcion",
      "Cantidad",
      "Elaboracion etiquetas",
      "Etiquetado almacen",
      "Etiquetas requeridas",
      "Ultima impresion",
      "Fecha despacho",
      "Responsable"
    ];
    const rows = orders.flatMap((order) =>
      order.lines.map((line) => [
        order.code,
        order.customer,
        line.sku,
        line.description,
        String(line.quantity ?? 0),
        labelDevelopmentLabels[getLabelDevelopmentStatus(line)],
        warehouseLabelingLabels[getWarehouseLabelingStatus(line)],
        (line.labelRequirements ?? [])
          .map((requirement) => `${requirement.quantity} ${requirement.type} ${requirement.variant} ${requirement.sizeCode}`)
          .join(" | "),
        line.printHistory?.[0] ? `${line.printHistory[0].user} ${formatDateTime(line.printHistory[0].at)} ${line.printHistory[0].quantity}` : "",
        order.dispatchDate,
        order.owner
      ])
    );
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pedidos-orvel-${todayString()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function downloadBackup() {
    setSyncMessage("Generando backup...");
    try {
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: currentUser || "Operaciones", pin: currentPin })
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorData.error || "No se pudo generar el backup.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `flip-backup-${todayString()}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setSyncMessage("Backup descargado");
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : "No se pudo generar el backup.");
    }
  }

  function toggleColumn(orderId: string, column: string) {
    setHiddenColumnsByOrder((current) => {
      const hidden = new Set(current[orderId] ?? []);
      if (hidden.has(column)) {
        hidden.delete(column);
      } else {
        hidden.add(column);
      }
      return { ...current, [orderId]: Array.from(hidden) };
    });
  }

  async function closeOrder(orderId: string) {
    await patchOrder(orderId, { type: "close" }, "Pedido cerrado y links conservados");
    setActiveTab("historico");
  }

  async function restoreOrder(orderId: string) {
    await patchOrder(orderId, { type: "restore" }, "Pedido restaurado");
    setSelectedOrderId(orderId);
    setActiveTab("pedidos");
  }

  async function addFile(orderId: string) {
    if (!fileDraft.name.trim() || !fileDraft.url.trim()) return;

    await patchOrder(
      orderId,
      {
        type: "addFile",
        file: { id: uid("file"), ...fileDraft, storageStatus: "temporal" }
      },
      "Link temporal agregado"
    );
    setFileDraft(defaultFileDraft);
  }

  async function uploadFiles(orderId: string, files: FileList | null) {
    if (!files || files.length === 0) {
      setFileUploadFeedback((current) => ({
        ...current,
        [orderId]: { message: "No se seleccionaron archivos.", tone: "warning" }
      }));
      return;
    }

    const selectedFiles = Array.from(files);
    const order = orders.find((item) => item.id === orderId);
    if (!order) {
      setFileUploadFeedback((current) => ({
        ...current,
        [orderId]: { message: "Pedido no encontrado para subir archivos.", tone: "error" }
      }));
      return;
    }

    const uploadCandidates = selectedFiles.map((file) => buildUploadCandidate(file, order));
    const matchedByName = uploadCandidates.filter((candidate) => candidate.sku).length;
    const duplicateCandidates = uploadCandidates.filter((candidate) => order.files.some((file) => fileMatchesUploadCandidate(file, candidate)));
    const candidateByFile = new Map(uploadCandidates.map((candidate) => [candidate.file, candidate]));
    const overwriteExisting =
      order.destination !== "usa" && duplicateCandidates.length > 0
        ? window.confirm(
            `Detecte ${duplicateCandidates.length} archivo(s) que parecen existir para el mismo SKU/tipo/tamano. Aceptar reemplaza el registro anterior; Cancelar conserva lo anterior y agrega los nuevos.`
          )
        : false;

    const batches = buildUploadBatches(selectedFiles);

    setSyncMessage("Subiendo archivos...");
    setFileUploadFeedback((current) => ({
      ...current,
      [orderId]: {
        message:
          matchedByName === 0
            ? "Subiendo archivos. No detecte SKU en el nombre; si no coincide con el pedido, se descartara."
            : `Subiendo ${selectedFiles.length} archivo(s) en ${batches.length} lote(s). Detecte ${matchedByName} posible(s) coincidencia(s) por SKU.`,
        tone: matchedByName === 0 ? "warning" : "neutral"
      }
    }));

    try {
      const uploadedFiles: LinkedFile[] = [];
      const rejectedFiles: Array<{ name: string; reason: string }> = [];
      const replacedFiles: LinkedFile[] = [];

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex];
        const formData = new FormData();
        formData.append("orderId", orderId);
        formData.append("user", currentUser || "Operaciones");
        formData.append("pin", currentPin);
        formData.append("overwriteExisting", overwriteExisting ? "1" : "0");
        formData.append(
          "fileMetadata",
          JSON.stringify(
            batch.map((file) => {
              const candidate = candidateByFile.get(file);
              return {
                type: candidate?.type,
                sku: candidate?.sku,
                labelSizeCode: candidate?.labelSizeCode,
                labelSize: labelSizeValue(candidate?.labelSizeCode),
                labelCategory: candidate?.labelCategory
              };
            })
          )
        );
        batch.forEach((file) => formData.append("files", file));

        setFileUploadFeedback((current) => ({
          ...current,
          [orderId]: {
            message: `Subiendo lote ${batchIndex + 1} de ${batches.length} (${batch.length} archivo(s)).`,
            tone: "neutral"
          }
        }));

        const response = await fetch("/api/files", {
          method: "POST",
          body: formData
        });

        const data = (await response.json().catch(() => ({}))) as Partial<UploadFilesResponse> & { error?: string };
        if (!response.ok || !data.orders) throw new Error(data.error || "No se pudieron subir archivos.");

        setOrders(data.orders);
        uploadedFiles.push(...(data.uploaded ?? []));
        rejectedFiles.push(...(data.rejected ?? []));
        replacedFiles.push(...(data.replaced ?? []));
      }

      const uploadedCount = uploadedFiles.length;
      const rejectedCount = rejectedFiles.length;
      const replacedCount = replacedFiles.length;
      const rejectedSummary = summarizeRejectedFiles(rejectedFiles);
      let nextMessage = "";
      let nextTone: UploadFeedback["tone"] = "neutral";

      if (uploadedCount > 0 && rejectedCount > 0) {
        nextMessage = `${uploadedCount} archivo(s) ligados${replacedCount ? `; ${replacedCount} reemplazado(s)` : ""}. ${rejectedCount} descartado(s) sin SKU coincidente${rejectedSummary ? `: ${rejectedSummary}` : "."}`;
        nextTone = "warning";
      } else if (uploadedCount > 0) {
        nextMessage = `${uploadedCount} archivo(s) ligados correctamente al pedido${replacedCount ? `; ${replacedCount} reemplazado(s)` : ""}.`;
        nextTone = "success";
      } else {
        nextMessage = `No se subio nada. ${rejectedCount} archivo(s) descartado(s) porque no tienen SKU coincidente en este pedido${
          rejectedSummary ? `: ${rejectedSummary}` : "."
        }`;
        nextTone = "error";
      }

      setSyncMessage(nextMessage);
      setFileUploadFeedback((current) => ({
        ...current,
        [orderId]: { message: nextMessage, tone: nextTone }
      }));
    } catch (error) {
      const message = uploadErrorMessage(error);
      setSyncMessage(message);
      setFileUploadFeedback((current) => ({
        ...current,
        [orderId]: { message, tone: "error" }
      }));
    }
  }

  function applyImportDefaults(rows: ImportPreviewRow[]) {
    const first = rows.find((row) => row.sku || row.description);
    setImportMeta((current) => ({
      ...current,
      code: first?.pedido || current.code,
      customer: first?.cliente || current.customer,
      owner: first?.responsable || current.owner,
      priority: first?.prioridad || current.priority,
      dispatchDate: first?.fechaDespacho || current.dispatchDate
    }));
  }

  function previewPaste() {
    const rows = parseTableText(importText);
    setPreviewRows(rows);
    applyImportDefaults(rows);
    setImportMessage(rows.length ? `${rows.length} lineas detectadas.` : "No pude detectar una tabla valida.");
  }

  async function previewExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportMessage(`Leyendo ${file.name}...`);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/import", {
        method: "POST",
        body: formData
      });
      const data = (await response.json()) as {
        rows?: ImportPreviewRow[];
        message?: string;
        error?: string;
        suggestedMeta?: Partial<ImportMeta>;
      };

      if (!response.ok || !data.rows) {
        throw new Error(data.error || "No se pudo leer el archivo.");
      }

      setPreviewRows(data.rows);
      applyImportDefaults(data.rows);
      if (data.suggestedMeta) {
        setImportMeta((current) => ({
          ...current,
          code: current.code || data.suggestedMeta?.code || "",
          customer: current.customer || data.suggestedMeta?.customer || ""
        }));
      }
      setImportMessage(data.message || `${data.rows.length} lineas detectadas desde ${file.name}.`);
    } catch (error) {
      setPreviewRows([]);
      setImportMessage(error instanceof Error ? error.message : "No se pudo leer el Excel.");
    } finally {
      event.target.value = "";
    }
  }

  async function createOrderFromPreview() {
    const usableRows = previewRows.filter((row) => row.sku || row.description);
    if (!usableRows.length || !importMeta.code.trim() || !importMeta.customer.trim()) {
      setImportMessage("Faltan lineas validas, pedido o cliente.");
      return;
    }

    const lines: OrderLine[] = usableRows.map((row, index) => ({
      id: uid("line"),
      sku: row.sku || `SIN-SKU-${index + 1}`,
      description: row.description || "Sin descripcion",
      quantity: Number(row.quantity) || 0,
      originalData: row.originalData,
      lineColor: inferInitialLineColor(row),
      warehouseStatus: "nothing_requested",
      labelDevelopmentStatus: "no_ha_llegado",
      warehouseLabelingStatus: "no_iniciado",
      labelRequirements: [],
      printHistory: [],
      piecesPerCase: row.piecesPerCase,
      labelCode: row.labelCode,
      caseLabelCode: row.caseLabelCode,
      expirationDate: row.expirationDate,
      weightKg: row.weightKg,
      volumeM3: row.volumeM3,
      satCode: row.satCode,
      taricCode: row.taricCode,
      comments: row.comments
    }));

    const estimate = calculateEstimate(lines);
    const hasMissingLabels = estimate.missingLabels > 0;
    const existingOrder = orders.find((candidate) => candidate.code.toLowerCase() === importMeta.code.trim().toLowerCase());
    const order: Order = {
      id: replaceExistingOrder && existingOrder ? existingOrder.id : uid("ord"),
      code: importMeta.code.trim(),
      customer: importMeta.customer.trim(),
      owner: importMeta.owner.trim() || "Operaciones MX",
      destination: importMeta.destination,
      priority: importMeta.priority,
      status: hasMissingLabels ? "pendiente_archivos" : "importado",
      labelingStatus: hasMissingLabels ? "bloqueado" : "pendiente",
      approvalStatus: "pendiente",
      dispatchDate: importMeta.dispatchDate,
      createdAt: new Date().toISOString(),
      archived: false,
      progress: calculateLineProgress(lines).progress,
      columns: previewRows.find((row) => row.sourceColumns?.length)?.sourceColumns ?? Object.keys(lines[0]?.originalData ?? {}),
      lines,
      files: replaceExistingOrder && existingOrder ? existingOrder.files : [],
      history: [
        buildEvent(
          "importacion",
          `Pedido creado con ${lines.length} lineas. Estimacion inicial: ${estimate.estimatedHours.toFixed(1)} horas.`
        )
      ]
    };

    const initialFileCount = order.files.length;
    const nextOrders = await applyServerOrders(
      fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order, user: currentUser || "Operaciones", pin: currentPin })
      }),
      "Pedido creado correctamente"
    );
    const createdOrder = nextOrders.find((nextOrder) => nextOrder.id === order.id);
    const linkedResourceCount = Math.max(0, (createdOrder?.files.length ?? initialFileCount) - initialFileCount);
    setSelectedOrderId(order.id);
    setPreviewRows([]);
    setImportText("");
    setImportMeta(defaultImportMeta);
    setImportMessage(
      nextOrders.some((nextOrder) => nextOrder.id === order.id)
        ? linkedResourceCount
          ? `Pedido creado correctamente. ${linkedResourceCount} recurso(s) existentes ligados por SKU.`
          : "Pedido creado correctamente."
        : "No se pudo crear el pedido."
    );
    setActiveTab("pedidos");
  }

  async function resetDemoData() {
    const nextOrders = await applyServerOrders(
      fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset", user: currentUser || "Operaciones", pin: currentPin })
      }),
      "Datos demo reiniciados"
    );
    setSelectedOrderId(nextOrders.find((order) => !order.archived)?.id ?? nextOrders[0]?.id ?? "");
  }

  if (!loggedInUser) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="brand-lockup">
            <span className="brand-mark">FL</span>
            <div>
              <p className="eyebrow">Plataforma operativa</p>
              <h1>{APP_NAME}</h1>
            </div>
          </div>
          <p className="login-copy">Ingresa para ver pedidos, archivos, estatus y trazabilidad.</p>
          <label className="login-field">
            Usuario
            <select value={currentUser} onChange={(event) => setCurrentUser(event.target.value)}>
              {users.length === 0 && <option value={currentUser}>{currentUser}</option>}
              {users.map((user) => (
                <option key={user.id} value={user.name}>
                  {user.name} - {roleLabels[user.role]}
                </option>
              ))}
            </select>
          </label>
          <label className="login-field">
            PIN
            <input
              inputMode="numeric"
              onChange={(event) => setCurrentPin(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleLogin();
              }}
              placeholder="0000"
              type="password"
              value={currentPin}
            />
          </label>
          <button className="primary-button login-submit" disabled={loginLoading || loading} onClick={handleLogin} type="button">
            <CheckCircle2 size={18} />
            {loginLoading ? "Validando" : loading ? "Cargando" : "Entrar a Flip"}
          </button>
          <span className={`login-status-chip ${loginMessage.includes("incorrecto") ? "error" : ""}`}>{loginMessage}</span>
          <small className="login-sync">{syncMessage}</small>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand-lockup compact">
            <span className="brand-mark">FL</span>
            <div>
              <p className="eyebrow">Operacion de pedidos y etiquetado</p>
              <h1>{APP_NAME}</h1>
            </div>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="login-status-chip ok">Sesion: {loggedInUser}</span>
          <button className="ghost-button compact" onClick={() => setLoggedInUser("")} type="button">
            Salir
          </button>
          <span className="sync-chip">{loading ? "Cargando..." : syncMessage}</span>
          <button className="ghost-button" onClick={exportOrders} type="button">
            <Download size={18} />
            Exportar
          </button>
          <button className="ghost-button" onClick={() => void downloadBackup()} type="button">
            <Download size={18} />
            Backup
          </button>
          <button className="ghost-button" onClick={resetDemoData} type="button">
            <RotateCcw size={18} />
            Reiniciar demo
          </button>
          <button className="primary-button" onClick={() => setActiveTab("importar")} type="button">
            <Upload size={18} />
            Importar pedido
          </button>
        </div>
      </header>

      <section className="metric-grid">
        <MetricCard icon={<ClipboardList size={20} />} label="Pedidos activos" value={metrics.active.toString()} />
        <MetricCard icon={<AlertTriangle size={20} />} label="Atrasados" value={metrics.late.toString()} tone={metrics.late ? "danger" : "ok"} />
        <MetricCard icon={<Users size={20} />} label="Elaboracion etiquetas" value={`${metrics.labelProgress}%`} />
        <MetricCard
          icon={<Truck size={20} />}
          label="Etiquetado almacen"
          value={`${metrics.warehouseProgress}%`}
        />
        <MetricCard icon={<FolderOpen size={20} />} label="Carga estimada" value={`${metrics.workload.toFixed(1)} h / ${metrics.warehouseDays} d`} />
      </section>

      <nav className="module-tabs" aria-label="Modulos">
        <TabButton active={activeTab === "pedidos"} icon={<PackageCheck size={18} />} label="Pedidos" onClick={() => setActiveTab("pedidos")} />
        <TabButton active={activeTab === "calendario"} icon={<CalendarDays size={18} />} label="Calendario" onClick={() => setActiveTab("calendario")} />
        <TabButton active={activeTab === "importar"} icon={<Upload size={18} />} label="Importar" onClick={() => setActiveTab("importar")} />
        <TabButton active={activeTab === "historico"} icon={<Archive size={18} />} label="Historico" onClick={() => setActiveTab("historico")} />
        <TabButton active={activeTab === "catalogo"} icon={<CheckCircle2 size={18} />} label="Catalogo" onClick={() => setActiveTab("catalogo")} />
        <TabButton active={activeTab === "biblioteca"} icon={<FolderOpen size={18} />} label="Biblioteca" onClick={() => setActiveTab("biblioteca")} />
      </nav>

      {activeTab === "pedidos" && (
        <section className="orders-layout">
          <aside className="order-list-panel">
            <div className="search-box">
              <Search size={18} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar pedido, cliente, SKU o descripcion" />
            </div>
            <div className="filter-panel compact-filter-panel">
              <label>
                <SlidersHorizontal size={14} />
                Orden
                <select value={orderSort} onChange={(event) => setOrderSort(event.target.value as OrderSort)}>
                  <option value="priority">Prioridad / fecha</option>
                  <option value="az">A - Z</option>
                  <option value="za">Z - A</option>
                  <option value="high_low">Highest - Lowest</option>
                  <option value="low_high">Lowest - Highest</option>
                  <option value="newest">Newest - Oldest</option>
                </select>
              </label>
              <label>
                Usuario
                <select value={userFilter} onChange={(event) => setUserFilter(event.target.value)}>
                  <option value="">Todos</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.name}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="">Todos</option>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                  {Object.entries(warehouseLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                  {Object.entries(labelDevelopmentLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                  {Object.entries(warehouseLabelingLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Fecha
                <input value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} type="date" />
              </label>
            </div>
            <div className="order-list">
              {filteredActiveOrders.map((order) => (
                <button
                  className={`order-row ${selectedOrder?.id === order.id ? "selected" : ""}`}
                  key={order.id}
                  onClick={() => setSelectedOrderId(order.id)}
                  type="button"
                >
                  <span className={`priority-dot ${order.priority}`} />
                  <span>
                    <strong>{order.code}</strong>
                    <small>
                      {order.customer} - {formatDate(order.dispatchDate)}
                    </small>
                  </span>
                  <StatusPill status={order.status} />
                </button>
              ))}
            </div>
          </aside>

          {selectedOrder && (
            <OrderDetail
              addFile={addFile}
              deleteFile={deleteFile}
              changeDispatchDate={changeDispatchDate}
              closeOrder={closeOrder}
              fileDraft={fileDraft}
              fileUploadFeedback={fileUploadFeedback[selectedOrder.id]}
              hiddenColumns={hiddenColumnsByOrder[selectedOrder.id] ?? []}
              canClearFiles={(users.find((user) => user.name === currentUser)?.role ?? "") === "admin"}
              addLine={addLine}
              deleteLine={deleteLine}
              order={selectedOrder}
              resourceSourceOrders={orders.filter((order) => order.id !== selectedOrder.id && order.files.length > 0)}
              setFileDraft={setFileDraft}
              toggleColumn={toggleColumn}
              addLabelRequirement={addLabelRequirement}
              deleteLabelRequirement={deleteLabelRequirement}
              updateLineCell={updateLineCell}
              updateLineColor={updateLineColor}
              updateLineVisibility={updateLineVisibility}
              updateFileMeta={updateFileMeta}
              linkExistingResources={linkExistingResources}
              clearOrderFiles={clearOrderFiles}
              updateLabelDevelopmentStatus={updateLabelDevelopmentStatus}
              updateOrderField={updateOrderField}
              updateWarehouseLabelingStatus={updateWarehouseLabelingStatus}
              updateWarehouseStatus={updateWarehouseStatus}
              recordPrint={recordPrint}
              uploadFiles={uploadFiles}
            />
          )}
        </section>
      )}

      {activeTab === "calendario" && (
        <CalendarView
          calendarStart={calendarStart}
          changeDispatchDate={changeDispatchDate}
          orders={activeOrders}
          setCalendarStart={setCalendarStart}
        />
      )}

      {activeTab === "importar" && (
        <ImportView
          createOrderFromPreview={createOrderFromPreview}
          importMessage={importMessage}
          importMeta={importMeta}
          importText={importText}
          previewExcel={previewExcel}
          previewPaste={previewPaste}
          previewRows={previewRows}
          replaceExistingOrder={replaceExistingOrder}
          setImportMeta={setImportMeta}
          setImportText={setImportText}
          setReplaceExistingOrder={setReplaceExistingOrder}
        />
      )}

      {activeTab === "historico" && <HistoryView orders={archivedOrders} restoreOrder={restoreOrder} />}

      {activeTab === "catalogo" && <CatalogView deleteFile={deleteFile} orders={orders} replaceFile={replaceFile} />}

      {activeTab === "biblioteca" && <FileLibraryView deleteFile={deleteFile} orders={orders} replaceFile={replaceFile} />}

      <ChatWidget
        chatDirectTo={chatDirectTo}
        chatDraft={chatDraft}
        chatMessages={chatMessages}
        chatOpen={chatOpen}
        chatStatus={chatStatus}
        currentUser={currentUser}
        notificationPermission={notificationPermission}
        requestChatNotifications={requestChatNotifications}
        sendChatMessage={sendChatMessage}
        setChatDirectTo={setChatDirectTo}
        setChatDraft={setChatDraft}
        setChatOpen={setChatOpen}
        users={users}
      />
    </main>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone = "neutral"
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "neutral" | "danger" | "warning" | "ok";
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function TabButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={`tab-button ${active ? "active" : ""}`} onClick={onClick} type="button">
      {icon}
      {label}
    </button>
  );
}

function ChatWidget({
  chatDirectTo,
  chatDraft,
  chatMessages,
  chatOpen,
  chatStatus,
  currentUser,
  notificationPermission,
  requestChatNotifications,
  sendChatMessage,
  setChatDirectTo,
  setChatDraft,
  setChatOpen,
  users
}: {
  chatDirectTo: string;
  chatDraft: string;
  chatMessages: ChatMessage[];
  chatOpen: boolean;
  chatStatus: string;
  currentUser: string;
  notificationPermission: NotificationPermission;
  requestChatNotifications: () => void;
  sendChatMessage: () => void;
  setChatDirectTo: (value: string) => void;
  setChatDraft: (value: string) => void;
  setChatOpen: (value: boolean) => void;
  users: AppUser[];
}) {
  const unreadFromOthers = chatMessages.filter((message) => message.user !== currentUser).slice(-3).length;

  if (!chatOpen) {
    return (
      <button className="chat-fab" onClick={() => setChatOpen(true)} type="button">
        <MessageCircle size={20} />
        <span>Chat</span>
        {unreadFromOthers > 0 && <strong>{unreadFromOthers}</strong>}
      </button>
    );
  }

  return (
    <section className="chat-panel" aria-label="Chat operativo">
      <div className="chat-header">
        <div>
          <strong>Chat Flip</strong>
          <small>{chatStatus}</small>
        </div>
        <button className="ghost-button compact" onClick={() => setChatOpen(false)} type="button">
          Cerrar
        </button>
      </div>
      <div className="chat-tools">
        <select value={chatDirectTo} onChange={(event) => setChatDirectTo(event.target.value)}>
          <option value="">Todos</option>
          {users
            .filter((user) => user.name !== currentUser)
            .map((user) => (
              <option key={user.id} value={user.name}>
                Directo a {user.name}
              </option>
            ))}
        </select>
        <button className="ghost-button compact" onClick={requestChatNotifications} type="button">
          <Bell size={14} />
          {notificationPermission === "granted" ? "Alertas ON" : "Alertas"}
        </button>
      </div>
      <div className="chat-messages">
        {chatMessages.length === 0 && <p className="empty-text">Sin mensajes.</p>}
        {chatMessages.map((message) => (
          <article className={`chat-message ${message.user === currentUser ? "mine" : ""}`} key={message.id}>
            <span>
              {message.user}
              {message.directTo ? ` -> ${message.directTo}` : ""}
            </span>
            <p>{message.body}</p>
            <small>{formatDateTime(message.at)}</small>
          </article>
        ))}
      </div>
      <div className="chat-compose">
        <textarea
          onChange={(event) => setChatDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendChatMessage();
            }
          }}
          placeholder="Mensaje operativo..."
          value={chatDraft}
        />
        <button className="primary-button compact" onClick={() => void sendChatMessage()} type="button">
          <Send size={15} />
        </button>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: OrderStatus }) {
  return <span className={`status-pill ${status}`}>{statusLabels[status]}</span>;
}

function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`priority-badge ${priority}`}>{priorityLabels[priority]}</span>;
}

function LineFilePreview({ file, onDelete }: { file: LinkedFile; onDelete: () => void }) {
  return (
    <article className="line-file-preview">
      <a className="line-file-thumb" href={file.url} rel="noreferrer" target="_blank" title={file.name}>
        {file.previewable && file.type === "imagen" ? (
          <img alt={file.name} src={file.url} />
        ) : file.previewable && file.type === "pdf" ? (
          <iframe src={`${file.url}#toolbar=0&navpanes=0`} title={file.name} />
        ) : (
          <span>{file.type.toUpperCase()}</span>
        )}
      </a>
      <div>
        <strong>{file.name}</strong>
        <small>{file.sku ? `SKU ${file.sku}` : "Sin SKU"}</small>
      </div>
      <div className="line-file-actions">
        <a href={file.url} rel="noreferrer" target="_blank" title="Abrir archivo">
          <ExternalLink size={14} />
        </a>
        <button onClick={onDelete} title="Borrar archivo" type="button">
          <Trash2 size={14} />
        </button>
      </div>
    </article>
  );
}

function OrderDetail({
  order,
  changeDispatchDate,
  updateOrderField,
  updateLineColor,
  closeOrder,
  uploadFiles,
  fileDraft,
  fileUploadFeedback,
  canClearFiles,
  setFileDraft,
  addFile,
  deleteFile,
  addLine,
  deleteLine,
  hiddenColumns,
  resourceSourceOrders,
  toggleColumn,
  addLabelRequirement,
  deleteLabelRequirement,
  updateLineCell,
  updateLabelDevelopmentStatus,
  updateWarehouseLabelingStatus,
  updateWarehouseStatus,
  recordPrint,
  updateFileMeta,
  linkExistingResources,
  clearOrderFiles,
  updateLineVisibility
}: {
  order: Order;
  changeDispatchDate: (orderId: string, nextDate: string) => void;
  updateOrderField: <K extends keyof Order>(orderId: string, field: K, value: Order[K], label: string) => void;
  updateLineColor: (orderId: string, lineId: string, color: LineColor) => void;
  closeOrder: (orderId: string) => void;
  uploadFiles: (orderId: string, files: FileList | null) => void;
  fileDraft: FileDraft;
  fileUploadFeedback?: UploadFeedback;
  canClearFiles: boolean;
  setFileDraft: (draft: FileDraft) => void;
  addFile: (orderId: string) => void;
  deleteFile: (orderId: string, fileId: string) => void;
  addLine: (orderId: string, line: OrderLine) => void;
  deleteLine: (orderId: string, lineId: string) => void;
  hiddenColumns: string[];
  resourceSourceOrders: Order[];
  toggleColumn: (orderId: string, column: string) => void;
  addLabelRequirement: (orderId: string, lineId: string, requirement: LabelRequirement) => void;
  deleteLabelRequirement: (orderId: string, lineId: string, requirementId: string) => void;
  updateLineCell: (orderId: string, lineId: string, column: string, value: string) => void;
  updateLabelDevelopmentStatus: (orderId: string, lineId: string, status: LabelDevelopmentStatus) => void;
  updateWarehouseLabelingStatus: (orderId: string, lineId: string, status: WarehouseLabelingStatus) => void;
  updateWarehouseStatus: (orderId: string, lineId: string, status: WarehouseStatus) => void;
  recordPrint: (orderId: string, lineId: string, draft: PrintDraft) => void;
  updateFileMeta: (orderId: string, fileId: string, updates: FileMetadataUpdate) => void;
  linkExistingResources: (orderId: string, sourceOrderId?: string) => void;
  clearOrderFiles: (orderId: string) => void;
  updateLineVisibility: (orderId: string, lineId: string, hidden: boolean) => void;
}) {
  const planningConfig = getOrderPlanningConfig(order);
  const estimate = calculateDetailedEstimate(order.lines, planningConfig);
  const lineProgress = calculateLineProgress(order.lines);
  const plannedStart = addDays(order.dispatchDate, -estimate.estimatedDays);
  const [lineDraft, setLineDraft] = useState({ sku: "", description: "", quantity: "0" });
  const [skuSearch, setSkuSearch] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [lineSort, setLineSort] = useState<LineSort>("az");
  const [showHiddenLines, setShowHiddenLines] = useState(false);
  const [printDrafts, setPrintDrafts] = useState<Record<string, PrintDraft>>({});
  const [requirementDrafts, setRequirementDrafts] = useState<Record<string, RequirementDraft>>({});
  const [resourceSourceId, setResourceSourceId] = useState("same_customer");
  const [clearFilesConfirm, setClearFilesConfirm] = useState("");
  const allColumns = order.columns?.length ? order.columns : defaultOrderColumns;
  const visibleColumns = allColumns.filter((column) => !hiddenColumns.includes(column));
  const allTableColumns: TableColumnDef[] = [
    ...operationalLineColumns,
    ...allColumns.map((column) => ({ id: column, label: column, kind: "data" as const }))
  ];
  const visibleTableColumnCount = allTableColumns.filter((column) => !hiddenColumns.includes(column.id)).length;
  const isVisibleColumn = (columnId: string) => !hiddenColumns.includes(columnId);
  const fileGalleryGroups = Object.entries(fileTypeLabels)
    .map(([type, label]) => ({
      type: type as FileType,
      label,
      files: order.files.filter((file) => file.type === type)
    }))
    .filter((group) => group.files.length > 0);
  const labelDevProgress = averageProgress(order.lines, (line) => labelDevelopmentProgress[getLabelDevelopmentStatus(line)]);
  const warehouseProgress = averageProgress(order.lines, (line) => warehouseLabelingProgress[getWarehouseLabelingStatus(line)]);
  const hiddenLineCount = order.lines.filter((line) => line.hidden).length;
  const filteredLines = useMemo(() => {
    const needle = normalizeText(skuSearch);
    return [...order.lines]
      .filter(
        (line) =>
          (showHiddenLines || !line.hidden) &&
          (!needle || normalizeText(`${line.sku} ${line.description}`).includes(needle)) &&
          (!warehouseFilter ||
            getWarehouseStatus(line) === warehouseFilter ||
            getLabelDevelopmentStatus(line) === warehouseFilter ||
            getWarehouseLabelingStatus(line) === warehouseFilter)
      )
      .sort((a, b) => compareLinesBySort(a, b, lineSort));
  }, [lineSort, order.lines, showHiddenLines, skuSearch, warehouseFilter]);

  function handleAddLine() {
    if (!lineDraft.sku.trim()) return;
    const quantity = Number(lineDraft.quantity) || 0;
    const originalData: Record<string, string | number | boolean | null> = {
      CODE: lineDraft.sku.trim(),
      DRESCRIPTION: lineDraft.description.trim(),
      PEDIDO: quantity
    };

    addLine(order.id, {
      id: uid("line"),
      sku: lineDraft.sku.trim(),
      description: lineDraft.description.trim() || "Sin descripcion",
      quantity,
      originalData,
      warehouseStatus: "nothing_requested",
      labelDevelopmentStatus: "no_ha_llegado",
      warehouseLabelingStatus: "no_iniciado",
      labelRequirements: [],
      printHistory: [],
      lineColor: "sin_color"
    });
    setLineDraft({ sku: "", description: "", quantity: "0" });
  }

  function commitLineCell(lineId: string, column: string, currentValue: string, nextValue: string) {
    if (nextValue === currentValue) return;
    updateLineCell(order.id, lineId, column, nextValue);
  }

  function getPrintDraft(lineId: string): PrintDraft {
    return printDrafts[lineId] ?? { quantity: "1", labelType: "Etiqueta producto", labelSizeCode: "L1" };
  }

  function updatePrintDraft(lineId: string, patch: Partial<PrintDraft>) {
    setPrintDrafts((current) => ({
      ...current,
      [lineId]: {
        ...getPrintDraft(lineId),
        ...patch
      }
    }));
  }

  function handleRecordPrint(line: OrderLine) {
    const draft = getPrintDraft(line.id);
    recordPrint(order.id, line.id, draft);
    updatePrintDraft(line.id, { quantity: "1" });
  }

  function getRequirementDraft(lineId: string): RequirementDraft {
    return requirementDrafts[lineId] ?? { quantity: "1", type: "Producto", variant: "General", sizeCode: "L1" };
  }

  function updateRequirementDraft(lineId: string, patch: Partial<RequirementDraft>) {
    setRequirementDrafts((current) => ({
      ...current,
      [lineId]: {
        ...getRequirementDraft(lineId),
        ...patch
      }
    }));
  }

  function handleAddRequirement(line: OrderLine) {
    const draft = getRequirementDraft(line.id);
    const labelSize = labelSizes.find((size) => size.code === draft.sizeCode) ?? labelSizes[0];
    addLabelRequirement(order.id, line.id, {
      id: uid("req"),
      quantity: Math.max(1, Number(draft.quantity) || 1),
      type: draft.type.trim() || "Producto",
      variant: draft.variant.trim() || "General",
      sizeCode: labelSize.code,
      size: labelSize.size
    });
    updateRequirementDraft(line.id, { quantity: "1" });
  }

  return (
    <section className="detail-panel">
      <div className="detail-header">
        <div>
          <p className="eyebrow">Pedido/proyecto</p>
          <h2>{order.code}</h2>
          <div className="header-badges">
            <PriorityBadge priority={order.priority} />
            <StatusPill status={order.status} />
            {isLate(order) && <span className="alert-badge">Atrasado</span>}
          </div>
        </div>
        <button className="danger-button" onClick={() => closeOrder(order.id)} type="button">
          <Archive size={18} />
          Cerrar
        </button>
      </div>

      <div className="detail-grid">
        <label>
          Pedido/proyecto
          <input
            value={order.code}
            onChange={(event) => updateOrderField(order.id, "code", event.target.value, `Pedido/proyecto actualizado a ${event.target.value}.`)}
          />
        </label>
        <label>
          Cliente
          <input
            value={order.customer}
            onChange={(event) => updateOrderField(order.id, "customer", event.target.value, `Cliente actualizado a ${event.target.value}.`)}
          />
        </label>
        <label>
          Responsable
          <input
            value={order.owner}
            onChange={(event) => updateOrderField(order.id, "owner", event.target.value, `Responsable actualizado a ${event.target.value}.`)}
          />
        </label>
        <label>
          Destino
          <select
            value={order.destination ?? "mexico"}
            onChange={(event) =>
              updateOrderField(
                order.id,
                "destination",
                event.target.value as OrderDestination,
                `Destino cambiado a ${destinationLabels[event.target.value as OrderDestination]}.`
              )
            }
          >
            {Object.entries(destinationLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Prioridad
          <select
            value={order.priority}
            onChange={(event) => updateOrderField(order.id, "priority", event.target.value as Priority, `Prioridad cambiada a ${event.target.value}.`)}
          >
            {Object.entries(priorityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fecha despacho
          <input value={order.dispatchDate} onChange={(event) => changeDispatchDate(order.id, event.target.value)} type="date" />
        </label>
        <label>
          Estado general
          <select
            value={order.status}
            onChange={(event) =>
              updateOrderField(order.id, "status", event.target.value as OrderStatus, `Estado cambiado a ${statusLabels[event.target.value as OrderStatus]}.`)
            }
          >
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Etiquetado
          <select
            value={order.labelingStatus}
            onChange={(event) =>
              updateOrderField(
                order.id,
                "labelingStatus",
                event.target.value as LabelingStatus,
                `Etiquetado cambiado a ${labelingLabels[event.target.value as LabelingStatus]}.`
              )
            }
          >
            {Object.entries(labelingLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Aprobacion
          <select
            value={order.approvalStatus}
            onChange={(event) =>
              updateOrderField(
                order.id,
                "approvalStatus",
                event.target.value as ApprovalStatus,
                `Aprobacion cambiada a ${approvalLabels[event.target.value as ApprovalStatus]}.`
              )
            }
          >
            {Object.entries(approvalLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="auto-progress-card">
          <span>Avance automatico</span>
          <strong>{lineProgress.progress}%</strong>
          <small>
            {lineProgress.completed} de {lineProgress.total} SKUs en verde
          </small>
        </div>
      </div>

      <section className="notes-block">
        <div className="section-title compact-title">
          <h3>Order Notes / Requirements</h3>
          <span>Guardado en historial</span>
        </div>
        <textarea
          key={order.id}
          onBlur={(event) =>
            updateOrderField(order.id, "notes", event.target.value, "Order Notes / Requirements actualizado.")
          }
          defaultValue={order.notes ?? ""}
          placeholder="Customer requirements, operational notes, special handling, warehouse instructions..."
        />
      </section>

      <section className="estimate-band">
        <div>
          <span>Inicio sugerido</span>
          <strong>{formatDate(plannedStart)}</strong>
        </div>
        <div>
          <span>Tiempo etiquetado</span>
          <strong>{estimate.estimatedDays} dia(s)</strong>
        </div>
        <div>
          <span>Horas estimadas</span>
          <strong>{estimate.estimatedHours.toFixed(1)} h</strong>
        </div>
        <div>
          <span>SKUs / piezas</span>
          <strong>
            {estimate.skuCount} / {estimate.totalQuantity}
          </strong>
        </div>
        <div>
          <span>Peso / volumen</span>
          <strong>
            {sumWeight(order.lines).toFixed(1)} kg / {sumVolume(order.lines).toFixed(2)} m3
          </strong>
        </div>
      </section>

      <section className="progress-section">
        <div className="progress-header">
          <span>Avance operativo</span>
          <strong>{lineProgress.progress}%</strong>
        </div>
        <div className="progress-track">
          <div style={{ width: `${lineProgress.progress}%` }} />
        </div>
      </section>

      <section className="process-dashboard">
        <article>
          <div className="section-title compact-title">
            <h3>Elaboracion de etiquetas</h3>
            <strong>{labelDevProgress}%</strong>
          </div>
          <div className="progress-track label-design">
            <div style={{ width: `${labelDevProgress}%` }} />
          </div>
          <dl>
            <div>
              <dt>Etiquetas requeridas</dt>
              <dd>{estimate.labelCount}</dd>
            </div>
            <div>
              <dt>Tiempo estimado</dt>
              <dd>{estimate.labelDesignHours?.toFixed(1)} h / {estimate.labelDesignDays} d</dd>
            </div>
          </dl>
        </article>
        <article>
          <div className="section-title compact-title">
            <h3>Etiquetado / almacen</h3>
            <strong>{warehouseProgress}%</strong>
          </div>
          <div className="progress-track warehouse-work">
            <div style={{ width: `${warehouseProgress}%` }} />
          </div>
          <dl>
            <div>
              <dt>Productos</dt>
              <dd>{estimate.totalQuantity}</dd>
            </div>
            <div>
              <dt>Tiempo estimado</dt>
              <dd>{estimate.warehouseDays} d / {estimate.warehousePeople} pers.</dd>
            </div>
          </dl>
        </article>
        <article className="capacity-config">
          <div className="section-title compact-title">
            <h3>Calculo de capacidad</h3>
          </div>
          <label>
            Minutos por etiqueta
            <input
              min="1"
              type="number"
              value={planningConfig.labelMinutesPerLabel}
              onChange={(event) =>
                updateOrderField(
                  order.id,
                  "planningConfig",
                  { ...planningConfig, labelMinutesPerLabel: Number(event.target.value) || 15 },
                  "Tiempo promedio de elaboracion actualizado."
                )
              }
            />
          </label>
          <label>
            Personal base
            <input
              min="1"
              type="number"
              value={planningConfig.basePeople}
              onChange={(event) =>
                updateOrderField(
                  order.id,
                  "planningConfig",
                  { ...planningConfig, basePeople: Number(event.target.value) || 1 },
                  "Personal base actualizado."
                )
              }
            />
          </label>
          <label>
            Personal eventual
            <input
              min="0"
              type="number"
              value={planningConfig.tempPeople}
              onChange={(event) =>
                updateOrderField(
                  order.id,
                  "planningConfig",
                  { ...planningConfig, tempPeople: Number(event.target.value) || 0 },
                  "Personal eventual actualizado."
                )
              }
            />
          </label>
          <label>
            Productos por persona/dia
            <input
              min="1"
              type="number"
              value={planningConfig.warehouseUnitsPerPersonPerDay}
              onChange={(event) =>
                updateOrderField(
                  order.id,
                  "planningConfig",
                  { ...planningConfig, warehouseUnitsPerPersonPerDay: Number(event.target.value) || 2000 },
                  "Productividad de almacen actualizada."
                )
              }
            />
          </label>
        </article>
      </section>

      <section className="split-section order-lines-section">
        <div className="order-lines-card">
          <div className="section-title">
            <h3>Lineas del pedido</h3>
            <span>{filteredLines.length} visibles / {order.lines.length} SKUs{hiddenLineCount ? ` - ${hiddenLineCount} ocultas` : ""}</span>
          </div>
          <div className="line-filter-bar">
            <div className="search-box inline-search">
              <Search size={16} />
              <input value={skuSearch} onChange={(event) => setSkuSearch(event.target.value)} placeholder="Buscar SKU o descripcion" />
            </div>
            <label>
              Estado almacen
              <select value={warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value)}>
                <option value="">Todos</option>
                {Object.entries(warehouseLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
                {Object.entries(labelDevelopmentLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
                {Object.entries(warehouseLabelingLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Orden
              <select value={lineSort} onChange={(event) => setLineSort(event.target.value as LineSort)}>
                <option value="az">A - Z</option>
                <option value="za">Z - A</option>
                <option value="high_low">Highest - Lowest</option>
                <option value="low_high">Lowest - Highest</option>
                <option value="newest">Newest - Oldest</option>
              </select>
            </label>
            <label className="inline-check line-visibility-toggle">
              <input checked={showHiddenLines} onChange={(event) => setShowHiddenLines(event.target.checked)} type="checkbox" />
              Mostrar filas ocultas
            </label>
          </div>
          <div className="column-toolbar">
            <div>
              <strong>Columnas visibles</strong>
              <span>{visibleTableColumnCount} de {allTableColumns.length}</span>
            </div>
            <div className="column-toggles">
              {allTableColumns.map((column) => (
                <button
                  className={`column-toggle ${hiddenColumns.includes(column.id) ? "hidden" : ""}`}
                  key={column.id}
                  onClick={() => toggleColumn(order.id, column.id)}
                  title={hiddenColumns.includes(column.id) ? `Mostrar ${column.label}` : `Ocultar ${column.label}`}
                  type="button"
                >
                  {hiddenColumns.includes(column.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                  <span>{column.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="add-line-form">
            <input placeholder="SKU" value={lineDraft.sku} onChange={(event) => setLineDraft({ ...lineDraft, sku: event.target.value })} />
            <input
              placeholder="Descripcion"
              value={lineDraft.description}
              onChange={(event) => setLineDraft({ ...lineDraft, description: event.target.value })}
            />
            <input
              min="0"
              placeholder="Cantidad"
              type="number"
              value={lineDraft.quantity}
              onChange={(event) => setLineDraft({ ...lineDraft, quantity: event.target.value })}
            />
            <button className="primary-button compact" onClick={handleAddLine} type="button">
              <Plus size={16} />
              Agregar linea
            </button>
          </div>
          <div className="table-wrap order-lines-table">
            <table>
              <thead>
                <tr>
                  {isVisibleColumn("__status_color") && <th>Color</th>}
                  {isVisibleColumn("__label_dev") && <th>Elaboracion etiquetas</th>}
                  {isVisibleColumn("__warehouse_labeling") && <th>Etiquetado / almacen</th>}
                  {isVisibleColumn("__requirements") && <th>Etiquetas requeridas</th>}
                  {isVisibleColumn("__suggested") && <th>Multiplicacion sugerida</th>}
                  {visibleColumns.map((column) => (
                    <th className={isDescriptionColumn(column) ? "description-header" : undefined} key={column} title={column}>
                      <div className="column-heading">
                        <span>{column}</span>
                        <button
                          aria-label={`Ocultar columna ${column}`}
                          className="column-eye-button"
                          onClick={() => toggleColumn(order.id, column)}
                          title={`Ocultar ${column}`}
                          type="button"
                        >
                          <EyeOff size={14} />
                        </button>
                      </div>
                    </th>
                  ))}
                  {isVisibleColumn("__files") && <th>Archivos</th>}
                  {isVisibleColumn("__print") && <th>Print Tracking</th>}
                  {isVisibleColumn("__actions") && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {filteredLines.map((line) => {
                  const filesForLine = order.files.filter((file) => file.sku === line.sku || file.lineId === line.id);
                  const printDraft = getPrintDraft(line.id);
                  const labelSize = labelSizes.find((size) => size.code === printDraft.labelSizeCode) ?? labelSizes[0];
                  const lastPrint = line.printHistory?.[0];
                  const suggestedPieces = suggestedPiecesForLine(line);
                  return (
                    <tr className={`line-row ${getLineColor(line)} ${line.hidden ? "hidden-line" : ""}`} key={line.id}>
                      {isVisibleColumn("__status_color") && (
                      <td>
                        <div className="line-color-controls">
                          <span className={`line-color-select readonly ${getLineColor(line)}`}>
                            {lineColorLabels[getLineColor(line)]}
                          </span>
                          <small>Segun elaboracion</small>
                        </div>
                      </td>
                      )}
                      {isVisibleColumn("__label_dev") && (
                      <td>
                        <div className="process-status-cell">
                          <span className={`process-badge label-${getLabelDevelopmentStatus(line)}`}>
                            {labelDevelopmentLabels[getLabelDevelopmentStatus(line)]}
                          </span>
                          <div className="mini-progress label-design">
                            <div style={{ width: `${labelDevelopmentProgress[getLabelDevelopmentStatus(line)]}%` }} />
                          </div>
                          <select
                            value={getLabelDevelopmentStatus(line)}
                            onChange={(event) => updateLabelDevelopmentStatus(order.id, line.id, event.target.value as LabelDevelopmentStatus)}
                          >
                            {Object.entries(labelDevelopmentLabels).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      )}
                      {isVisibleColumn("__warehouse_labeling") && (
                      <td>
                        <div className="process-status-cell">
                          <span className={`process-badge warehouse-${getWarehouseLabelingStatus(line)}`}>
                            {warehouseLabelingLabels[getWarehouseLabelingStatus(line)]}
                          </span>
                          <div className="mini-progress warehouse-work">
                            <div style={{ width: `${warehouseLabelingProgress[getWarehouseLabelingStatus(line)]}%` }} />
                          </div>
                          <select
                            value={getWarehouseLabelingStatus(line)}
                            onChange={(event) => updateWarehouseLabelingStatus(order.id, line.id, event.target.value as WarehouseLabelingStatus)}
                          >
                            {Object.entries(warehouseLabelingLabels).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      )}
                      {isVisibleColumn("__requirements") && (
                      <td>
                        <div className="requirement-cell">
                          {(line.labelRequirements ?? []).length === 0 && <span className="muted-mini">Sin requerimientos</span>}
                          {(line.labelRequirements ?? []).map((requirement) => (
                            <span className="requirement-chip" key={requirement.id}>
                              {requirement.quantity}x {requirement.type} / {requirement.variant} / {requirement.sizeCode}
                              <button onClick={() => deleteLabelRequirement(order.id, line.id, requirement.id)} type="button">x</button>
                            </span>
                          ))}
                          <div className="requirement-form">
                            <input
                              min="1"
                              type="number"
                              value={getRequirementDraft(line.id).quantity}
                              onChange={(event) => updateRequirementDraft(line.id, { quantity: event.target.value })}
                            />
                            <input
                              placeholder="Tipo"
                              value={getRequirementDraft(line.id).type}
                              onChange={(event) => updateRequirementDraft(line.id, { type: event.target.value })}
                            />
                            <input
                              placeholder="Variante"
                              value={getRequirementDraft(line.id).variant}
                              onChange={(event) => updateRequirementDraft(line.id, { variant: event.target.value })}
                            />
                            <select value={getRequirementDraft(line.id).sizeCode} onChange={(event) => updateRequirementDraft(line.id, { sizeCode: event.target.value })}>
                              {labelSizes.map((size) => (
                                <option key={size.code} value={size.code}>
                                  {size.code}
                                </option>
                              ))}
                            </select>
                            <button className="ghost-button compact" onClick={() => handleAddRequirement(line)} type="button">
                              <Plus size={14} />
                            </button>
                          </div>
                        </div>
                      </td>
                      )}
                      {isVisibleColumn("__suggested") && (
                      <td>
                        <div className="suggested-multiplication">
                          {suggestedPieces ? (
                            <>
                              <strong>{suggestedPieces.total.toLocaleString("es-MX")}</strong>
                              <span>
                                {suggestedPieces.pedido.toLocaleString("es-MX")} pedido x {suggestedPieces.piecesPerCase.toLocaleString("es-MX")} pza/caja
                              </span>
                              <small>Solo sugerido</small>
                            </>
                          ) : (
                            <span className="muted-mini">Sin datos suficientes</span>
                          )}
                        </div>
                      </td>
                      )}
                      {visibleColumns.map((column) => (
                        <td
                          className={[
                            isSkuColumn(column) ? `sku-cell ${getLineColor(line)}` : "",
                            isDescriptionColumn(column) ? "description-cell" : ""
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          key={column}
                        >
                          {(() => {
                            const currentValue = lineValueForColumn(line, column);
                            return isSkuColumn(column) ? (
                              <div className="sku-edit-wrap">
                                <input
                                  aria-label={`Editar ${column} de ${line.sku}`}
                                  className="cell-edit sku"
                                  defaultValue={currentValue}
                                  onBlur={(event) => commitLineCell(line.id, column, currentValue, event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") event.currentTarget.blur();
                                  }}
                                />
                                <small>{lineColorLabels[getLineColor(line)]}</small>
                              </div>
                            ) : isDescriptionColumn(column) ? (
                              <textarea
                                aria-label={`Editar ${column} de ${line.sku}`}
                                className="cell-edit cell-edit-multiline"
                                defaultValue={currentValue}
                                onBlur={(event) => commitLineCell(line.id, column, currentValue, event.target.value)}
                                placeholder="N/D"
                                rows={rowsForDescription(currentValue)}
                              />
                            ) : (
                              <input
                                aria-label={`Editar ${column} de ${line.sku}`}
                                className="cell-edit"
                                defaultValue={currentValue}
                                onBlur={(event) => commitLineCell(line.id, column, currentValue, event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") event.currentTarget.blur();
                                }}
                                placeholder="N/D"
                              />
                            );
                          })()}
                        </td>
                      ))}
                      {isVisibleColumn("__files") && (
                      <td>
                        <div className="line-file-preview-list">
                          {filesForLine.length === 0 && <span className="muted-mini">Sin archivos</span>}
                          {filesForLine.map((file) => (
                            <LineFilePreview file={file} key={file.id} onDelete={() => deleteFile(order.id, file.id)} />
                          ))}
                        </div>
                      </td>
                      )}
                      {isVisibleColumn("__print") && (
                      <td>
                        <div className="print-tracking-cell">
                          <div className="print-controls">
                            <input
                              min="1"
                              value={printDraft.quantity}
                              onChange={(event) => updatePrintDraft(line.id, { quantity: event.target.value })}
                              type="number"
                            />
                            <select value={printDraft.labelSizeCode} onChange={(event) => updatePrintDraft(line.id, { labelSizeCode: event.target.value })}>
                              {labelSizes.map((size) => (
                                <option key={size.code} value={size.code}>
                                  {size.code} {size.size}
                                </option>
                              ))}
                            </select>
                            <select value={printDraft.labelType} onChange={(event) => updatePrintDraft(line.id, { labelType: event.target.value })}>
                              <option value="Etiqueta producto">Etiqueta producto</option>
                              <option value="Etiqueta caja">Etiqueta caja</option>
                              <option value="Etiqueta orden">Etiqueta orden</option>
                              <option value="Reprint">Reprint</option>
                            </select>
                            <button className="primary-button compact" onClick={() => handleRecordPrint(line)} type="button">
                              <Printer size={15} />
                              Registrar
                            </button>
                          </div>
                          <small>
                            {lastPrint
                              ? `${lastPrint.user} - ${formatDateTime(lastPrint.at)} - ${lastPrint.quantity} ${lastPrint.labelSizeCode}`
                              : `Sin impresiones - ${labelSize.code} ${labelSize.size}`}
                          </small>
                          {(line.printHistory?.length ?? 0) > 0 && (
                            <div className="print-history-mini">
                              {line.printHistory?.slice(0, 3).map((record) => (
                                <span key={record.id}>
                                  {record.labelType}: {record.quantity} - {record.labelSizeCode} {record.labelSize}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      )}
                      {isVisibleColumn("__actions") && (
                      <td>
                        <div className="line-actions">
                          <button className="ghost-button compact" onClick={() => updateLineVisibility(order.id, line.id, !line.hidden)} type="button">
                            {line.hidden ? "Mostrar" : "Ocultar"}
                          </button>
                          <button className="icon-danger" onClick={() => deleteLine(order.id, line.id)} title="Eliminar linea" type="button">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="side-stack">
          <section className="files-panel">
            <div className="section-title">
              <h3>Archivos relacionados</h3>
              <span>{order.files.length}</span>
            </div>
            <label className="upload-drop">
              <Paperclip size={18} />
              Subir archivos .nlbl, .btw, imagenes o PDF
              <input
                accept=".nlbl,.btw,.png,.jpg,.jpeg,.webp,.gif,.pdf"
                multiple
                onChange={(event) => {
                  void uploadFiles(order.id, event.target.files);
                  event.target.value = "";
                }}
                type="file"
              />
            </label>
            <p className="upload-help">El nombre del archivo debe incluir el SKU del pedido. Si no hay coincidencia, se descarta automaticamente.</p>
            <div className="resource-link-panel">
              <label>
                Referencia de recursos
                <select value={resourceSourceId} onChange={(event) => setResourceSourceId(event.target.value)}>
                  <option value="same_customer">Solo pedidos del mismo cliente</option>
                  {resourceSourceOrders.map((sourceOrder) => (
                    <option key={sourceOrder.id} value={sourceOrder.id}>
                      {sourceOrder.code} - {sourceOrder.customer}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="ghost-button compact resource-link-button"
                onClick={() => linkExistingResources(order.id, resourceSourceId === "same_customer" ? undefined : resourceSourceId)}
                type="button"
              >
                <FolderOpen size={16} />
                Detectar recursos existentes
              </button>
            </div>
            {fileUploadFeedback && (
              <div className={`upload-feedback ${fileUploadFeedback.tone}`} aria-live="polite">
                {fileUploadFeedback.message}
              </div>
            )}
            {canClearFiles && (
              <details className="danger-zone">
                <summary>Zona protegida de archivos</summary>
                <p>Elimina todos los archivos ligados a este pedido. Las referencias de otros pedidos se quitan de aqui, pero no borran el archivo original.</p>
                <label>
                  Escribe BORRAR ARCHIVOS
                  <input value={clearFilesConfirm} onChange={(event) => setClearFilesConfirm(event.target.value)} placeholder="BORRAR ARCHIVOS" />
                </label>
                <button
                  className="danger-button compact"
                  disabled={clearFilesConfirm !== "BORRAR ARCHIVOS" || order.files.length === 0}
                  onClick={() => {
                    if (window.confirm(`Se eliminaran ${order.files.length} archivo(s) ligados a ${order.code}.`)) {
                      void clearOrderFiles(order.id);
                      setClearFilesConfirm("");
                    }
                  }}
                  type="button"
                >
                  <Trash2 size={16} />
                  Borrar todos los archivos de este pedido
                </button>
              </details>
            )}
            <div className="file-form">
              <select value={fileDraft.type} onChange={(event) => setFileDraft({ ...fileDraft, type: event.target.value as FileType })}>
                {Object.entries(fileTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input placeholder="Nombre del archivo" value={fileDraft.name} onChange={(event) => setFileDraft({ ...fileDraft, name: event.target.value })} />
              <input placeholder="Liga OneDrive/Drive/SharePoint" value={fileDraft.url} onChange={(event) => setFileDraft({ ...fileDraft, url: event.target.value })} />
              <button className="primary-button compact" onClick={() => addFile(order.id)} type="button">
                <FilePlus2 size={16} />
                Agregar
              </button>
            </div>
            <div className="file-list">
              {order.files.length === 0 && <p className="empty-text">Sin archivos ligados.</p>}
              {fileGalleryGroups.map((group) => (
                <section className="file-gallery-group" key={group.type}>
                  <div className="file-gallery-heading">
                    <strong>{group.label}</strong>
                    <span>{group.files.length}</span>
                  </div>
                  <div className="file-gallery-grid">
              {group.files.map((file) => (
                <div className="file-card" key={file.id}>
                  <div className="file-card-header">
                    <a href={file.url} rel="noreferrer" target="_blank">
                      <Link2 size={16} />
                      <span>
                        <strong>{file.name}</strong>
                        <small>
                          {fileTypeLabels[file.type]} - {file.storageStatus === "conservado" ? "Conservado en historico" : "Temporal activo"}
                        </small>
                      </span>
                      <ExternalLink size={14} />
                    </a>
                    <button className="icon-danger file-delete-button" onClick={() => deleteFile(order.id, file.id)} title="Eliminar archivo" type="button">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="file-meta-badges">
                    <span>{file.sku ? `SKU ${file.sku}` : "Sin SKU"}</span>
                    <span>{file.labelSizeCode ? `${file.labelSizeCode} ${file.labelSize ?? ""}` : "Sin tamano"}</span>
                    <span>{file.labelCategory || "General"}</span>
                    {file.sourceOrderCode && <span>Origen {file.sourceOrderCode}</span>}
                    <span>{formatFileSize(file.size)}</span>
                  </div>
                  <div className="file-meta-grid">
                    <label>
                      Nombre visible
                      <input
                        defaultValue={file.name}
                        onBlur={(event) => {
                          const nextName = event.target.value.trim();
                          if (nextName && nextName !== file.name) updateFileMeta(order.id, file.id, { name: nextName });
                        }}
                      />
                    </label>
                    <label>
                      Tipo
                      <select value={file.type} onChange={(event) => updateFileMeta(order.id, file.id, { type: event.target.value as FileType })}>
                        {Object.entries(fileTypeLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      SKU asignado
                      <select value={file.sku ?? ""} onChange={(event) => updateFileMeta(order.id, file.id, { sku: event.target.value })}>
                        <option value="">Sin asignar</option>
                        {order.lines.map((line) => (
                          <option key={line.id} value={line.sku}>
                            {line.sku} - {line.description}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Tamano etiqueta
                      <select value={file.labelSizeCode ?? ""} onChange={(event) => updateFileMeta(order.id, file.id, { labelSizeCode: event.target.value })}>
                        <option value="">Sin tamano</option>
                        {labelSizes.map((size) => (
                          <option key={size.code} value={size.code}>
                            {size.code} {size.size}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Categoria
                      <input
                        defaultValue={file.labelCategory ?? ""}
                        onBlur={(event) => updateFileMeta(order.id, file.id, { labelCategory: event.target.value.trim() || "General" })}
                        placeholder="Producto, Caja, General"
                      />
                    </label>
                    <label>
                      Variante
                      <input
                        defaultValue={file.labelVariant ?? ""}
                        onBlur={(event) => updateFileMeta(order.id, file.id, { labelVariant: event.target.value.trim() })}
                        placeholder="Cliente, idioma, version"
                      />
                    </label>
                  </div>
                  {file.previewable && file.type === "imagen" && <img alt={file.name} className="file-preview-image" src={file.url} />}
                  {file.previewable && file.type === "pdf" && <iframe className="file-preview-pdf" src={file.url} title={file.name} />}
                </div>
              ))}
                  </div>
                </section>
              ))}
            </div>
          </section>

          <section className="history-panel">
            <div className="section-title">
              <h3>Bitacora</h3>
              <History size={18} />
            </div>
            <div className="history-list">
              {order.history.slice(0, 8).map((event) => (
                <article key={event.id}>
                  <span>{formatDateTime(event.at)}</span>
                  <strong>{event.type}</strong>
                  <p>{event.message}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </section>
  );
}

function CalendarView({
  orders,
  calendarStart,
  setCalendarStart,
  changeDispatchDate
}: {
  orders: Order[];
  calendarStart: string;
  setCalendarStart: (date: string) => void;
  changeDispatchDate: (orderId: string, nextDate: string) => void;
}) {
  const activeMonth = startOfMonth(calendarStart);
  const days = getMonthGridDays(activeMonth);
  const weekdays = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];

  const eventsByDay = days.map((day) => {
    const events = orders
      .flatMap((order) => {
        const estimate = calculateDetailedEstimate(order.lines, getOrderPlanningConfig(order));
        const labelStart = addDays(order.dispatchDate, -(estimate.labelDesignDays ?? 0) - (estimate.warehouseDays ?? 0));
        const warehouseStart = addDays(order.dispatchDate, -(estimate.warehouseDays ?? 0));
        const inLabelDesignWindow = (estimate.labelDesignDays ?? 0) > 0 && day >= labelStart && day < warehouseStart;
        const inWarehouseWindow = (estimate.warehouseDays ?? 0) > 0 && day >= warehouseStart && day < order.dispatchDate;
        const isDispatch = day === order.dispatchDate;
        const orderEvents = [];

        if (inLabelDesignWindow) {
          orderEvents.push({
            order,
            type: "label_design" as const,
            hours: (estimate.labelDesignHours ?? 0) / Math.max(1, estimate.labelDesignDays ?? 1)
          });
        }

        if (inWarehouseWindow) {
          orderEvents.push({
            order,
            type: "warehouse_labeling" as const,
            hours: DAILY_CAPACITY_HOURS * 0.8
          });
        }

        if (isDispatch) {
          orderEvents.push({
            order,
            type: "dispatch" as const,
            hours: 0
          });
        }

        return orderEvents;
      })
      .filter(Boolean) as { order: Order; type: "dispatch" | "label_design" | "warehouse_labeling"; hours: number }[];

    const load = events.reduce((sum, event) => sum + event.hours, 0);
    return { day, events, load };
  });

  return (
    <section className="calendar-panel">
      <div className="calendar-toolbar">
        <div>
          <p className="eyebrow">Planificacion dinamica</p>
          <h2>Calendario mensual - {monthTitle(activeMonth)}</h2>
        </div>
        <div className="calendar-actions">
          <button className="ghost-button" onClick={() => setCalendarStart(addMonths(activeMonth, -1))} type="button">
            <ChevronLeft size={18} />
            Mes anterior
          </button>
          <button className="ghost-button" onClick={() => setCalendarStart(todayString())} type="button">
            Hoy
          </button>
          <button className="ghost-button" onClick={() => setCalendarStart(addMonths(activeMonth, 1))} type="button">
            Mes siguiente
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className="weekday-grid">
        {weekdays.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {eventsByDay.map(({ day, events, load }) => {
          const loadPct = Math.min(100, (load / DAILY_CAPACITY_HOURS) * 100);
          const outsideMonth = day.slice(0, 7) !== activeMonth.slice(0, 7);
          return (
            <article className={`day-card ${day === todayString() ? "today" : ""} ${outsideMonth ? "outside-month" : ""}`} key={day}>
              <div className="day-header">
                <strong>{new Date(`${day}T12:00:00`).getDate()}</strong>
                <span>{load.toFixed(1)} h</span>
              </div>
              <div className="capacity-track">
                <div style={{ width: `${loadPct}%` }} />
              </div>
              <div className="calendar-events">
                {events.length === 0 && <p className="empty-text">Sin carga.</p>}
                {events.map((event) => (
                  <div className={`calendar-event ${event.type} ${event.order.priority}`} key={`${event.order.id}-${event.type}`}>
                    <span>{event.type === "dispatch" ? "Despacho" : event.type === "label_design" ? "Elab. etiquetas" : "Almacen"}</span>
                    <strong>{event.order.code}</strong>
                    <small>{event.order.customer}</small>
                    {event.type === "dispatch" && (
                      <div className="event-actions">
                        <button onClick={() => changeDispatchDate(event.order.id, addDays(event.order.dispatchDate, -1))} type="button">
                          -1d
                        </button>
                        <button onClick={() => changeDispatchDate(event.order.id, addDays(event.order.dispatchDate, 1))} type="button">
                          +1d
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ImportView({
  importText,
  setImportText,
  previewPaste,
  previewExcel,
  previewRows,
  importMeta,
  setImportMeta,
  createOrderFromPreview,
  importMessage,
  replaceExistingOrder,
  setReplaceExistingOrder
}: {
  importText: string;
  setImportText: (value: string) => void;
  previewPaste: () => void;
  previewExcel: (event: ChangeEvent<HTMLInputElement>) => void;
  previewRows: ImportPreviewRow[];
  importMeta: ImportMeta;
  setImportMeta: (value: ImportMeta) => void;
  createOrderFromPreview: () => void;
  importMessage: string;
  replaceExistingOrder: boolean;
  setReplaceExistingOrder: (value: boolean) => void;
}) {
  const previewColumns = previewRows.find((row) => row.sourceColumns?.length)?.sourceColumns ?? defaultOrderColumns;
  const estimate = calculateEstimate(
    previewRows.map((row, index) => ({
      id: row.id || `preview-${index}`,
      sku: row.sku || "",
      description: row.description || "",
      quantity: Number(row.quantity) || 0,
      labelCode: row.labelCode,
      caseLabelCode: row.caseLabelCode
    }))
  );

  return (
    <section className="import-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Carga controlada</p>
          <h2>Importar desde Excel o pegado</h2>
        </div>
        <label className="file-upload">
          <Upload size={18} />
          Subir Excel
          <input accept=".xlsx,.csv" onChange={previewExcel} type="file" />
        </label>
      </div>

      <div className="import-layout">
        <section className="paste-area">
          <textarea
            onChange={(event) => setImportText(event.target.value)}
            placeholder="Pega aqui columnas desde Excel. Incluye encabezados como SKU, Description, Pedido, Cliente, Codigo Etiqueta, Caducidad, Weight, Volume..."
            value={importText}
          />
          <button className="primary-button" onClick={previewPaste} type="button">
            <ClipboardList size={18} />
            Previsualizar pegado
          </button>
        </section>

        <section className="import-meta">
          <label>
            Pedido/proyecto
            <input value={importMeta.code} onChange={(event) => setImportMeta({ ...importMeta, code: event.target.value })} />
          </label>
          <label>
            Cliente
            <input value={importMeta.customer} onChange={(event) => setImportMeta({ ...importMeta, customer: event.target.value })} />
          </label>
          <label>
            Responsable
            <input value={importMeta.owner} onChange={(event) => setImportMeta({ ...importMeta, owner: event.target.value })} />
          </label>
          <label>
            Destino
            <select value={importMeta.destination} onChange={(event) => setImportMeta({ ...importMeta, destination: event.target.value as OrderDestination })}>
              {Object.entries(destinationLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Prioridad
            <select value={importMeta.priority} onChange={(event) => setImportMeta({ ...importMeta, priority: event.target.value as Priority })}>
              {Object.entries(priorityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fecha despacho
            <input value={importMeta.dispatchDate} onChange={(event) => setImportMeta({ ...importMeta, dispatchDate: event.target.value })} type="date" />
          </label>
          <label className="inline-check">
            <input checked={replaceExistingOrder} onChange={(event) => setReplaceExistingOrder(event.target.checked)} type="checkbox" />
            Sobrescribir pedido si ya existe
          </label>
          <div className="import-summary">
            <span>{previewRows.length} lineas detectadas</span>
            <strong>{estimate.estimatedHours.toFixed(1)} h estimadas</strong>
            <small>{estimate.missingLabels} lineas con etiqueta incompleta</small>
          </div>
          <button className="primary-button wide" onClick={createOrderFromPreview} type="button">
            <PackageCheck size={18} />
            Crear pedido
          </button>
          {importMessage && <p className="form-message">{importMessage}</p>}
        </section>
      </div>

      <div className="table-wrap preview-table">
        <table>
          <thead>
            <tr>
              {previewColumns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.slice(0, 50).map((row, index) => (
              <tr key={row.id || index}>
                {previewColumns.map((column) => (
                  <td key={column}>{String(row.originalData?.[column] ?? "") || "N/D"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HistoryView({ orders, restoreOrder }: { orders: Order[]; restoreOrder: (orderId: string) => void }) {
  return (
    <section className="history-archive">
      <div className="section-title">
        <div>
          <p className="eyebrow">Consulta historica</p>
          <h2>Pedidos cerrados</h2>
        </div>
        <span>{orders.length} archivados</span>
      </div>
      <div className="archive-grid">
        {orders.map((order) => (
          <article className="archive-card" key={order.id}>
            <div>
              <PriorityBadge priority={order.priority} />
              <h3>{order.code}</h3>
              <p>{order.customer}</p>
            </div>
            <dl>
              <div>
                <dt>Despacho</dt>
                <dd>{formatDate(order.dispatchDate)}</dd>
              </div>
              <div>
                <dt>Cierre</dt>
                <dd>{order.closedAt ? formatDateTime(order.closedAt) : "N/D"}</dd>
              </div>
              <div>
                <dt>Lineas</dt>
                <dd>{order.lines.length}</dd>
              </div>
            </dl>
            <button className="ghost-button" onClick={() => restoreOrder(order.id)} type="button">
              Restaurar
            </button>
          </article>
        ))}
        {orders.length === 0 && <p className="empty-text">Todavia no hay pedidos cerrados.</p>}
      </div>
    </section>
  );
}

type FileLibraryActions = {
  deleteFile: (orderId: string, fileId: string) => void;
  replaceFile: (orderId: string, file: LinkedFile, files: FileList | null) => void;
};

function FileLibraryView({ orders, deleteFile, replaceFile }: { orders: Order[] } & FileLibraryActions) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const allItems = useMemo(() => buildFileLibraryItems(orders), [orders]);
  const filteredItems = useMemo(() => {
    const needle = normalizeText(search);
    return allItems.filter((item) => (!typeFilter || item.file.type === typeFilter) && (!needle || fileLibraryHaystack(item).includes(needle)));
  }, [allItems, search, typeFilter]);

  return (
    <section className="library-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Biblioteca de recursos</p>
          <h2>Archivos, imagenes y documentos</h2>
        </div>
        <span>
          {filteredItems.length} de {allItems.length}
        </span>
      </div>
      <div className="library-toolbar">
        <div className="search-box">
          <Search size={18} />
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por SKU, pedido, cliente, archivo o descripcion"
            value={search}
          />
        </div>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="">Todos los tipos</option>
          {Object.entries(fileTypeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <FileLibraryGroups deleteFile={deleteFile} emptyText="Todavia no hay archivos ligados a pedidos." items={filteredItems} replaceFile={replaceFile} />
    </section>
  );
}

function FileLibraryGroups({
  items,
  deleteFile,
  replaceFile,
  emptyText
}: {
  items: FileLibraryItem[];
  emptyText: string;
} & FileLibraryActions) {
  const groups = groupFileLibraryItems(items);

  if (groups.length === 0) return <p className="empty-text">{emptyText}</p>;

  return (
    <div className="library-groups">
      {groups.map((group) => (
        <section className="library-group" key={group.type}>
          <div className="file-gallery-heading">
            <strong>{group.label}</strong>
            <span>{group.items.length}</span>
          </div>
          <div className="library-grid">
            {group.items.map((item) => (
              <FileLibraryCard
                deleteFile={deleteFile}
                item={item}
                key={`${item.order.id}-${item.file.id}`}
                replaceFile={replaceFile}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function FileLibraryCard({ item, deleteFile, replaceFile }: { item: FileLibraryItem } & FileLibraryActions) {
  const { file, order, line } = item;
  const canReplace = Boolean(file.sku && file.type !== "drive");

  return (
    <article className="library-file-card">
      <a className="library-preview" href={file.url} rel="noreferrer" target="_blank" title={file.name}>
        {file.previewable && file.type === "imagen" ? (
          <img alt={file.name} src={file.url} />
        ) : file.previewable && file.type === "pdf" ? (
          <iframe src={`${file.url}#toolbar=0&navpanes=0`} title={file.name} />
        ) : (
          <span>{file.type.toUpperCase()}</span>
        )}
      </a>
      <div className="library-file-body">
        <div className="library-file-title">
          <strong>{file.name}</strong>
          <small>
            {order.code} - {order.customer}
          </small>
        </div>
        <div className="file-meta-badges">
          <span>{file.sku ? `SKU ${file.sku}` : "Sin SKU"}</span>
          <span>{line?.description || "Sin descripcion"}</span>
          <span>{fileTypeLabels[file.type]}</span>
          <span>{file.labelSizeCode ? `${file.labelSizeCode} ${file.labelSize ?? ""}` : "Sin tamano"}</span>
          <span>{file.labelCategory || "General"}</span>
          <span>{file.storageStatus === "conservado" || order.archived ? "Historico" : "Temporal"}</span>
          <span>{formatFileSize(file.size)}</span>
        </div>
        <div className="library-actions">
          <a className="ghost-button compact" href={file.url} rel="noreferrer" target="_blank">
            <ExternalLink size={14} />
            Abrir
          </a>
          {canReplace && (
            <label className="ghost-button compact file-replace-label">
              <Upload size={14} />
              Reemplazar
              <input
                accept=".nlbl,.btw,.png,.jpg,.jpeg,.webp,.gif,.pdf"
                onChange={(event) => {
                  void replaceFile(order.id, file, event.target.files);
                  event.currentTarget.value = "";
                }}
                type="file"
              />
            </label>
          )}
          <button
            className="danger-button compact"
            onClick={() => {
              if (window.confirm(`Quitar ${file.name} de ${order.code}?`)) deleteFile(order.id, file.id);
            }}
            type="button"
          >
            <Trash2 size={14} />
            Quitar
          </button>
        </div>
      </div>
    </article>
  );
}

function CatalogView({ orders, deleteFile, replaceFile }: { orders: Order[] } & FileLibraryActions) {
  const [productSearch, setProductSearch] = useState("");
  const [fileSearch, setFileSearch] = useState("");
  const [fileTypeFilter, setFileTypeFilter] = useState("");
  const products = useMemo(() => {
    const map = new Map<string, OrderLine>();
    orders.flatMap((order) => order.lines).forEach((line) => {
      if (!map.has(line.sku)) map.set(line.sku, line);
    });
    return Array.from(map.values()).sort((a, b) => a.sku.localeCompare(b.sku));
  }, [orders]);
  const filteredProducts = useMemo(() => {
    const needle = normalizeText(productSearch);
    return products.filter((product) => !needle || normalizeText(`${product.sku} ${product.description}`).includes(needle));
  }, [productSearch, products]);
  const storedItems = useMemo(() => buildFileLibraryItems(orders).filter(isStoredCatalogItem), [orders]);
  const filteredStoredItems = useMemo(() => {
    const needle = normalizeText(fileSearch);
    return storedItems.filter(
      (item) => (!fileTypeFilter || item.file.type === fileTypeFilter) && (!needle || fileLibraryHaystack(item).includes(needle))
    );
  }, [fileSearch, fileTypeFilter, storedItems]);

  return (
    <section className="catalog-panel">
      <div className="section-title">
        <div>
          <p className="eyebrow">Master data inicial</p>
          <h2>Catalogo SKU detectado</h2>
        </div>
        <span>
          {filteredProducts.length} de {products.length} SKUs
        </span>
      </div>
      <div className="catalog-toolbar">
        <div className="search-box">
          <Search size={18} />
          <input
            onChange={(event) => setProductSearch(event.target.value)}
            placeholder="Buscar SKU o descripcion"
            value={productSearch}
          />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Descripcion</th>
              <th>Etiqueta</th>
              <th>Etiqueta caja</th>
              <th>Peso kg</th>
              <th>Volumen m3</th>
              <th>SAT</th>
              <th>TARIC</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((product) => (
              <tr key={product.id}>
                <td>{product.sku}</td>
                <td>{product.description}</td>
                <td>{product.labelCode || "N/D"}</td>
                <td>{product.caseLabelCode || "N/D"}</td>
                <td>{product.weightKg ?? "N/D"}</td>
                <td>{product.volumeM3 ?? "N/D"}</td>
                <td>{product.satCode || "N/D"}</td>
                <td>{product.taricCode || "N/D"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="catalog-files-panel">
        <div className="section-title">
          <div>
            <p className="eyebrow">Recursos almacenados</p>
            <h3>Archivos historicos y cargados</h3>
          </div>
          <span>
            {filteredStoredItems.length} de {storedItems.length}
          </span>
        </div>
        <div className="library-toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              onChange={(event) => setFileSearch(event.target.value)}
              placeholder="Buscar archivo por SKU, pedido, cliente, tipo o descripcion"
              value={fileSearch}
            />
          </div>
          <select value={fileTypeFilter} onChange={(event) => setFileTypeFilter(event.target.value)}>
            <option value="">Todos los tipos</option>
            {Object.entries(fileTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <FileLibraryGroups
          deleteFile={deleteFile}
          emptyText="Todavia no hay archivos almacenados en catalogo."
          items={filteredStoredItems}
          replaceFile={replaceFile}
        />
      </section>
    </section>
  );
}
