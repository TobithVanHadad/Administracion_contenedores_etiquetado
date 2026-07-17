import { FileType, LabelDevelopmentStatus, LabelingStatus, LineColor, Order, OrderLine, OrderStatus } from "./types";

export const lineColorLabels: Record<LineColor, string> = {
  sin_color: "Sin color",
  rojo: "Bloqueado",
  amarillo: "En proceso",
  azul: "Revision",
  verde: "Terminado"
};

export function uid(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}

export function getLineColor(line: OrderLine): LineColor {
  return colorFromLabelDevelopment(line.labelDevelopmentStatus);
}

export function colorFromLabelDevelopment(status?: LabelDevelopmentStatus): LineColor {
  if (status === "etiqueta_lista") return "verde";
  if (status === "aprobado" || status === "enviado_aprobacion") return "azul";
  if (status === "sintanxis") return "amarillo";
  if (status === "no_ha_llegado") return "rojo";
  return "sin_color";
}

export function calculateLineProgress(lines: OrderLine[]) {
  const total = lines.length;
  const completed = lines.filter((line) => getLineColor(line) === "verde").length;
  const progress = total === 0 ? 0 : Math.round((completed / total) * 100);

  return { completed, total, progress };
}

export function buildEvent(type: string, message: string, user = "Operaciones") {
  return {
    id: uid("evt"),
    at: new Date().toISOString(),
    user,
    type,
    message
  };
}

export function normalizeOrder(order: Order): Order {
  const lineProgress = calculateLineProgress(order.lines);
  const columns =
    order.columns ??
    Array.from(
      new Set(
        order.lines
          .flatMap((line) => Object.keys(line.originalData ?? {}))
          .filter(Boolean)
      )
    );
  return {
    ...order,
    columns,
    destination: order.destination ?? "mexico",
    progress: lineProgress.progress,
    planningConfig: {
      labelMinutesPerLabel: order.planningConfig?.labelMinutesPerLabel ?? 15,
      warehouseUnitsPerPersonPerDay: order.planningConfig?.warehouseUnitsPerPersonPerDay ?? 2000,
      basePeople: order.planningConfig?.basePeople ?? 5,
      tempPeople: order.planningConfig?.tempPeople ?? 0
    },
    lines: order.lines.map((line) => ({
      ...line,
      hidden: line.hidden ?? false,
      warehouseStatus: line.warehouseStatus ?? "nothing_requested",
      labelDevelopmentStatus: line.labelDevelopmentStatus ?? "no_ha_llegado",
      warehouseLabelingStatus: line.warehouseLabelingStatus ?? "no_iniciado",
      labelRequirements: line.labelRequirements ?? [],
      printHistory: line.printHistory ?? [],
      originalData: line.originalData ?? {}
    })),
    files: order.files.map((file) => ({
      ...file,
      type: normalizeFileType(file.type),
      storageStatus: file.storageStatus ?? "temporal"
    }))
  };
}

function normalizeFileType(type: string): FileType {
  if (type === "nlbl" || type === "btw" || type === "imagen" || type === "pdf" || type === "drive" || type === "otro") return type;
  if (type === "etiqueta" || type === "ficha") return "pdf";
  return "otro";
}

export function statusFromLineProgress(order: Order, progress: number): { status: OrderStatus; labelingStatus: LabelingStatus } {
  if (order.status === "cerrado" || order.status === "despachado") {
    return { status: order.status, labelingStatus: order.labelingStatus };
  }

  if (progress === 100) {
    return { status: "etiquetado_completo", labelingStatus: "completo" };
  }

  if (progress > 0) {
    return { status: "etiquetando", labelingStatus: "en_proceso" };
  }

  return { status: order.status, labelingStatus: "pendiente" };
}
