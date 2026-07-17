export type Priority = "critica" | "alta" | "media" | "baja";

export type OrderStatus =
  | "importado"
  | "validacion"
  | "pendiente_archivos"
  | "pendiente_aprobacion"
  | "aprobado"
  | "etiquetando"
  | "etiquetado_completo"
  | "programado"
  | "despachado"
  | "cerrado";

export type LabelingStatus = "bloqueado" | "pendiente" | "en_proceso" | "completo";

export type ApprovalStatus = "pendiente" | "aprobado" | "rechazado";

export type FileType = "nlbl" | "btw" | "imagen" | "pdf" | "drive" | "otro";

export type LineColor = "sin_color" | "rojo" | "amarillo" | "azul" | "verde";

export type FileStorageStatus = "temporal" | "conservado";

export type UserRole = "admin" | "planning" | "planning_warehouse" | "planeacion" | "etiquetado" | "aprobador" | "consulta";

export type OrderDestination = "mexico" | "usa" | "europa" | "otro";

export type WarehouseStatus =
  | "nothing_requested"
  | "requested"
  | "in_process"
  | "printed"
  | "sent_to_warehouse"
  | "arrived_at_warehouse";

export type LabelDevelopmentStatus =
  | "no_ha_llegado"
  | "sintanxis"
  | "enviado_aprobacion"
  | "aprobado"
  | "etiqueta_lista";

export type WarehouseLabelingStatus = "no_iniciado" | "impreso" | "etiquetando" | "terminado";

export type LabelRequirement = {
  id: string;
  quantity: number;
  type: string;
  variant: string;
  sizeCode: string;
  size: string;
};

export type AppUser = {
  id: string;
  name: string;
  role: UserRole;
  active: boolean;
};

export type OrderLine = {
  id: string;
  sku: string;
  description: string;
  quantity: number;
  originalData?: Record<string, string | number | boolean | null>;
  lineColor?: LineColor;
  hidden?: boolean;
  warehouseStatus?: WarehouseStatus;
  labelDevelopmentStatus?: LabelDevelopmentStatus;
  warehouseLabelingStatus?: WarehouseLabelingStatus;
  labelRequirements?: LabelRequirement[];
  printHistory?: PrintRecord[];
  piecesPerCase?: number;
  labelCode?: string;
  caseLabelCode?: string;
  expirationDate?: string;
  weightKg?: number;
  volumeM3?: number;
  satCode?: string;
  taricCode?: string;
  comments?: string;
};

export type PrintRecord = {
  id: string;
  at: string;
  user: string;
  orderId: string;
  lineId: string;
  sku: string;
  quantity: number;
  labelType: string;
  labelSizeCode: string;
  labelSize: string;
};

export type LinkedFile = {
  id: string;
  type: FileType;
  name: string;
  url: string;
  sku?: string;
  lineId?: string;
  labelSizeCode?: string;
  labelSize?: string;
  labelCategory?: string;
  labelVariant?: string;
  sourceFileId?: string;
  sourceOrderId?: string;
  sourceOrderCode?: string;
  originalName?: string;
  storedName?: string;
  mimeType?: string;
  size?: number;
  previewable?: boolean;
  storageStatus?: FileStorageStatus;
  addedAt?: string;
  updatedAt?: string;
  preservedAt?: string;
};

export type OrderEvent = {
  id: string;
  at: string;
  user: string;
  type: string;
  message: string;
};

export type Order = {
  id: string;
  code: string;
  customer: string;
  owner: string;
  destination?: OrderDestination;
  priority: Priority;
  status: OrderStatus;
  labelingStatus: LabelingStatus;
  approvalStatus: ApprovalStatus;
  dispatchDate: string;
  createdAt: string;
  closedAt?: string;
  archived: boolean;
  progress: number;
  notes?: string;
  planningConfig?: PlanningConfig;
  columns?: string[];
  lines: OrderLine[];
  files: LinkedFile[];
  history: OrderEvent[];
};

export type ChatMessage = {
  id: string;
  at: string;
  user: string;
  body: string;
  directTo?: string;
};

export type ImportPreviewRow = Partial<OrderLine> & {
  pedido?: string;
  cliente?: string;
  prioridad?: Priority;
  responsable?: string;
  fechaDespacho?: string;
  sourceColumns?: string[];
};

export type OrderEstimate = {
  totalQuantity: number;
  skuCount: number;
  missingLabels: number;
  estimatedHours: number;
  estimatedDays: number;
  labelCount?: number;
  labelDesignHours?: number;
  labelDesignDays?: number;
  warehousePeople?: number;
  warehouseDays?: number;
};

export type PlanningConfig = {
  labelMinutesPerLabel: number;
  warehouseUnitsPerPersonPerDay: number;
  basePeople: number;
  tempPeople: number;
};
