import { NextRequest, NextResponse } from "next/server";
import { readSheet } from "read-excel-file/universal";
import { parseMatrixRows, parseTableText } from "@/lib/importer";

export const runtime = "nodejs";

function suggestedMetaFromFilename(filename: string) {
  const base = filename.replace(/\.[^.]+$/, "").trim();
  return {
    code: base.toUpperCase(),
    customer: base.toUpperCase()
  };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No se recibio archivo." }, { status: 400 });
    }

    const name = file.name.toLowerCase();

    if (name.endsWith(".csv")) {
      const text = await file.text();
      const rows = parseTableText(text);
      return NextResponse.json({
        rows,
        suggestedMeta: suggestedMetaFromFilename(file.name),
        message: `${rows.length} lineas detectadas desde ${file.name}.`
      });
    }

    if (!name.endsWith(".xlsx")) {
      return NextResponse.json({ error: "Por ahora sube archivos .xlsx. Para .xls, guardalo como .xlsx desde Excel." }, { status: 400 });
    }

    const sheetRows = (await readSheet(await file.arrayBuffer())) as unknown[][];
    const parsed = parseMatrixRows(sheetRows);

    return NextResponse.json({
      rows: parsed.rows,
      headerRow: parsed.headerRow,
      headers: parsed.headers,
      suggestedMeta: suggestedMetaFromFilename(file.name),
      message: `${parsed.rows.length} lineas detectadas desde ${file.name}. Encabezados en fila ${parsed.headerRow}.`
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo leer el Excel." },
      { status: 400 }
    );
  }
}
