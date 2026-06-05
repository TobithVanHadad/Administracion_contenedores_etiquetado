import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";

const railwayVolumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
const manualDataDir = process.env.ORVEL_DATA_DIR?.trim();
const runningOnRailway = Boolean(
  process.env.RAILWAY_SERVICE_ID || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_ID
);

export const dataDir = railwayVolumePath ? path.resolve(railwayVolumePath) : manualDataDir ? path.resolve(manualDataDir) : path.join(process.cwd(), "data");
export const uploadDir = path.join(dataDir, "uploads");

export function storageStatus() {
  return {
    dataDir,
    uploadDir,
    runningOnRailway,
    hasRailwayVolume: Boolean(railwayVolumePath),
    railwayVolumePath: railwayVolumePath || "",
    manualDataDir: manualDataDir || "",
    mode: railwayVolumePath ? "railway-volume" : manualDataDir ? "manual-data-dir" : "local-data"
  };
}

export async function ensurePersistentStorage() {
  const status = storageStatus();

  if (status.runningOnRailway && !status.hasRailwayVolume) {
    throw new Error(
      "Railway no tiene un volumen persistente conectado. Crea un Volume para este servicio y montalo en /data antes de subir o editar pedidos."
    );
  }

  await mkdir(dataDir, { recursive: true });
  const probePath = path.join(dataDir, ".orvel-write-test");
  await writeFile(probePath, new Date().toISOString(), "utf-8");
  await rm(probePath, { force: true });
}
