import { Order } from "./types";

const now = new Date().toISOString();

export const sampleOrders: Order[] = [
  {
    id: "ord-13-mayo",
    code: "CONTENEDOR 13 MAYO 4",
    customer: "EUROPA",
    owner: "Operaciones MX",
    priority: "alta",
    status: "etiquetando",
    labelingStatus: "en_proceso",
    approvalStatus: "aprobado",
    dispatchDate: "2026-05-18",
    createdAt: now,
    archived: false,
    progress: 62,
    notes: "Pedido activo migrado como ejemplo desde estructura de contenedor.",
    lines: [
      {
        id: "line-20873",
        sku: "20873",
        description: "Producto catalogado SKU 20873",
        quantity: 7,
        lineColor: "verde",
        piecesPerCase: 12,
        labelCode: "ETQ-20873",
        caseLabelCode: "CAJA-20873",
        weightKg: 6.4,
        volumeM3: 0.018,
        satCode: "50192100",
        taricCode: "190590",
        comments: "Revisar aprobacion final de etiqueta caja."
      },
      {
        id: "line-24951",
        sku: "24951",
        description: "Producto catalogado SKU 24951",
        quantity: 70,
        lineColor: "amarillo",
        piecesPerCase: 24,
        labelCode: "ETQ-24951",
        caseLabelCode: "CAJA-24951",
        weightKg: 4.8,
        volumeM3: 0.011,
        satCode: "220299",
        taricCode: "220210"
      },
      {
        id: "line-20344",
        sku: "20344",
        description: "Producto catalogado SKU 20344",
        quantity: 100,
        lineColor: "sin_color",
        piecesPerCase: 6,
        labelCode: "ETQ-20344",
        caseLabelCode: "CAJA-20344",
        weightKg: 12.2,
        volumeM3: 0.022,
        satCode: "340220",
        taricCode: "340250"
      }
    ],
    files: [
      {
        id: "file-1",
        type: "drive",
        name: "Carpeta de trabajo",
        url: "https://example.com/drive/pedido-13"
      },
      {
        id: "file-2",
        type: "pdf",
        name: "Etiquetas aprobadas",
        url: "https://example.com/labels/pedido-13"
      }
    ],
    history: [
      {
        id: "evt-1",
        at: now,
        user: "Sistema",
        type: "importacion",
        message: "Pedido cargado como ejemplo inicial."
      }
    ]
  },
  {
    id: "ord-poblano",
    code: "POBLANO 2",
    customer: "POBLANO",
    owner: "Etiquetado",
    priority: "critica",
    status: "pendiente_archivos",
    labelingStatus: "bloqueado",
    approvalStatus: "pendiente",
    dispatchDate: "2026-05-15",
    createdAt: now,
    archived: false,
    progress: 18,
    notes: "Bloqueado por archivos de etiqueta pendientes.",
    lines: [
      {
        id: "line-25880",
        sku: "25880",
        description: "Producto catalogado SKU 25880",
        quantity: 50,
        lineColor: "rojo",
        piecesPerCase: 12,
        labelCode: "",
        caseLabelCode: "",
        weightKg: 8.1,
        volumeM3: 0.016,
        comments: "Falta liga final de etiqueta."
      },
      {
        id: "line-21792",
        sku: "21792",
        description: "Producto catalogado SKU 21792",
        quantity: 31,
        lineColor: "amarillo",
        piecesPerCase: 6,
        labelCode: "ETQ-21792",
        caseLabelCode: "",
        weightKg: 10.4,
        volumeM3: 0.021
      }
    ],
    files: [],
    history: [
      {
        id: "evt-2",
        at: now,
        user: "Sistema",
        type: "bloqueo",
        message: "Pedido marcado con archivos pendientes."
      }
    ]
  },
  {
    id: "ord-camion-usa",
    code: "CAMION USA",
    customer: "USA",
    owner: "Planeacion",
    priority: "media",
    status: "cerrado",
    labelingStatus: "completo",
    approvalStatus: "aprobado",
    dispatchDate: "2026-05-06",
    createdAt: now,
    closedAt: "2026-05-07T18:00:00.000Z",
    archived: true,
    progress: 100,
    notes: "Ejemplo de pedido despachado y archivado.",
    lines: [
      {
        id: "line-usa-1",
        sku: "20280",
        description: "Producto exportacion USA",
        quantity: 37,
        lineColor: "verde",
        piecesPerCase: 12,
        labelCode: "USA-20280",
        caseLabelCode: "USA-CAJA-20280",
        weightKg: 7.3,
        volumeM3: 0.014
      }
    ],
    files: [
      {
        id: "file-usa",
        type: "pdf",
        name: "Ficha tecnica USA",
        url: "https://example.com/specs/usa"
      }
    ],
    history: [
      {
        id: "evt-3",
        at: "2026-05-07T18:00:00.000Z",
        user: "Sistema",
        type: "cierre",
        message: "Pedido cerrado y movido al historico."
      }
    ]
  }
];
