import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, requestAuditTag, verifySessionToken } from "@/lib/auth";
import { appendEditLog, getEquipmentDataUnredacted, updateEquipmentRow } from "@/lib/sheets";
import { isDeleted } from "@/lib/fields";
import { rowSnapshotHash } from "@/lib/recordHash";

export const dynamic = "force-dynamic";

function fieldValue(row: Record<string, string>, header: string | null): string {
  if (!header) return "";
  return (row[header] ?? "").trim();
}

function readEditPayload(
  body: unknown
): { values: Record<string, string>; expectedSnapshotHash: string } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.expectedSnapshotHash !== "string" || !b.expectedSnapshotHash) return null;
  if (!b.values || typeof b.values !== "object") return null;
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(b.values as Record<string, unknown>)) {
    if (typeof value !== "string") return null;
    values[key] = value;
  }
  return { values, expectedSnapshotHash: b.expectedSnapshotHash };
}

/** Edits one equipment row. superadmin: any row. admin: only a row whose
 * department column matches their own department — checked fresh against
 * the live sheet on every request, not just hidden in the UI. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ rowNumber: string }> }
) {
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  const { rowNumber: rowNumberParam } = await params;
  const rowNumber = Number(rowNumberParam);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    return NextResponse.json({ error: "หมายเลขแถวไม่ถูกต้อง" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const payload = readEditPayload(body);
  if (!payload) {
    return NextResponse.json({ error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, { status: 400 });
  }

  try {
    const snapshot = await getEquipmentDataUnredacted();
    const record = snapshot.rows.find((r) => r.rowNumber === rowNumber);
    if (!record || isDeleted(record.data, snapshot.fields)) {
      return NextResponse.json(
        { error: "ไม่พบรายการนี้ — อาจถูกย้ายหรือลบไปแล้ว กรุณารีเฟรชหน้า" },
        { status: 404 }
      );
    }

    if (session.role === "admin") {
      const rowDepartment = fieldValue(record.data, snapshot.fields.department);
      if (!rowDepartment || rowDepartment !== session.department) {
        return NextResponse.json({ error: "ไม่มีสิทธิ์แก้ไขรายการนี้" }, { status: 403 });
      }
    }

    const currentHash = rowSnapshotHash(snapshot.headers, record.data);
    if (currentHash !== payload.expectedSnapshotHash) {
      return NextResponse.json(
        { error: "ข้อมูลถูกแก้ไขโดยคนอื่นระหว่างที่คุณแก้ไข กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง" },
        { status: 409 }
      );
    }

    // Only accept values for headers that actually exist in the sheet.
    const nextValues: Record<string, string> = {};
    for (const header of snapshot.headers) {
      nextValues[header] = payload.values[header] ?? record.data[header] ?? "";
    }

    // admin can't smuggle a department change that would move a row out of
    // (or into) their own scope via this endpoint.
    if (session.role === "admin" && snapshot.fields.department) {
      nextValues[snapshot.fields.department] = session.department;
    }

    await updateEquipmentRow(rowNumber, snapshot.headers, nextValues);

    const timestamp = new Date().toISOString();
    const logDepartment = fieldValue(nextValues, snapshot.fields.department) || fieldValue(record.data, snapshot.fields.department);
    const auditTag = requestAuditTag(request);
    for (const header of snapshot.headers) {
      const oldValue = record.data[header] ?? "";
      const newValue = nextValues[header] ?? "";
      if (oldValue !== newValue) {
        try {
          await appendEditLog({
            timestamp,
            action: "แก้ไข",
            actor: session.username,
            department: logDepartment,
            rowNumber,
            column: header,
            oldValue,
            newValue: `${newValue} ${auditTag}`,
          });
        } catch (logErr: unknown) {
          console.error("appendEditLog failed:", logErr);
        }
      }
    }

    return NextResponse.json({
      rowNumber,
      values: nextValues,
      snapshotHash: rowSnapshotHash(snapshot.headers, nextValues),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
