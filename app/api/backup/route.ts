import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { readOrders, verifyLogin } from "@/lib/server-store";
import { uploadDir } from "@/lib/storage";
import { LinkedFile } from "@/lib/types";

export const runtime = "nodejs";

type ZipEntry = {
  name: string;
  data: Buffer;
};

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function buildZip(entries: ZipEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name.replace(/\\/g, "/"), "utf-8");
    const checksum = crc32(entry.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(entry.data.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(entry.data.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function safeZipName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 130);
}

function filePhysicalKey(orderId: string, file: LinkedFile) {
  return `${file.sourceOrderId || orderId}|${file.storedName || file.id}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const user = await verifyLogin({ user: body.user, pin: body.pin });
    if (user.role !== "admin") throw new Error("Solo Admin puede descargar backups.");

    const orders = await readOrders();
    const manifest = {
      createdAt: new Date().toISOString(),
      createdBy: user.name,
      orderCount: orders.length,
      fileLinks: 0,
      includedFiles: [] as Array<{ orderId: string; fileId: string; path: string; name: string }>,
      skippedFiles: [] as Array<{ orderId: string; fileId: string; name: string; reason: string }>
    };
    const entries: ZipEntry[] = [
      {
        name: "orders.json",
        data: Buffer.from(JSON.stringify(orders, null, 2), "utf-8")
      }
    ];
    const includedPhysicalFiles = new Set<string>();

    for (const order of orders) {
      for (const file of order.files) {
        manifest.fileLinks += 1;
        if (!file.storedName) {
          manifest.skippedFiles.push({ orderId: order.id, fileId: file.id, name: file.name, reason: "external-url" });
          continue;
        }

        const physicalKey = filePhysicalKey(order.id, file);
        if (includedPhysicalFiles.has(physicalKey)) continue;
        includedPhysicalFiles.add(physicalKey);

        const physicalOrderId = file.sourceOrderId || order.id;
        const sourcePath = path.join(uploadDir, physicalOrderId, file.storedName);
        const zipPath = `files/${safeZipName(physicalOrderId)}/${safeZipName(file.id)}__${safeZipName(file.originalName || file.name)}`;

        try {
          entries.push({ name: zipPath, data: await readFile(sourcePath) });
          manifest.includedFiles.push({ orderId: order.id, fileId: file.id, path: zipPath, name: file.name });
        } catch {
          manifest.skippedFiles.push({ orderId: order.id, fileId: file.id, name: file.name, reason: "missing-stored-file" });
        }
      }
    }

    entries.push({
      name: "manifest.json",
      data: Buffer.from(JSON.stringify(manifest, null, 2), "utf-8")
    });

    const zip = buildZip(entries);
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(zip, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="flip-backup-${stamp}.zip"`
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo generar el backup." }, { status: 400 });
  }
}
