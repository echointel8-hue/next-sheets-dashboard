import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, canAccessItDashboard, requestAuditTag, verifySessionToken } from "@/lib/auth";
import { appendEditLog, getEquipmentDataUnredacted, updateEquipmentRow } from "@/lib/sheets";
import { isDeleted } from "@/lib/fields";
import { rowSnapshotHash } from "@/lib/recordHash";

export const dynamic = "force-dynamic";

interface ItRecordPatchPayload {
  installLocation?: string;
  responsiblePerson?: string;
  expectedSnapshotHash?: string;
}

function readPayload(body: unknown): ItRecordPatchPayload | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const out: ItRecordPatchPayload = {};
  if (b.installLocation !== undefined) {
    if (typeof b.installLocation !== "string") return null;
    out.installLocation = b.installLocation;
  }
  if (b.responsiblePerson !== undefined) {
    if (typeof b.responsiblePerson !== "string") return null;
    out.responsiblePerson = b.responsiblePerson;
  }
  if (b.expectedSnapshotHash !== undefined) {
    if (typeof b.expectedSnapshotHash !== "string") return null;
    out.expectedSnapshotHash = b.expectedSnapshotHash;
  }
  // Reject an empty patch outright rather than silently no-op-ing — almost
  // certainly a client bug if it ever happens.
  if (out.installLocation === undefined && out.responsiblePerson === undefined) return null;
  return out;
}

/**
 * Narrow, deliberate exception to "it is read-only everywhere" (the general
 * edit route, /api/manage/records/[rowNumber] PATCH, blocks role "it"
 * outright). The maintenance-report screen (/manage/it/report) lets IT
 * staff fix a stale "สถานที่ตั้ง" / "ผู้รับผิดชอบครุภัณฑ์" right before
 * printing, and the hospital asked for that correction to also save back to
 * the sheet instead of only affecting the one printout. This endpoint
 * accepts *only* those two fields — asset number, brand/model, department,
 * equipment type, disposal status, everything else about a row stays
 * completely out of reach through it, so it does not reopen the broader
 * edit surface /manage/it was deliberately scoped away from. Reachable by
 * the same accounts as the rest of /manage/it (see canAccessItDashboard):
 * the "it" role and the bootstrap superadmin only. Logged under the
 * distinct "แก้ไข (IT)" EditLog action so this narrow path is always
 * distinguishable from a regular admin/superadmin edit in the audit trail.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ rowNumber: string }> }
) {
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  if (!canAccessItDashboard(session)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงหน้านี้" }, { status: 403 });
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
  const payload = readPayload(body);
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

    if (payload.expectedSnapshotHash) {
      const currentHash = rowSnapshotHash(snapshot.headers, record.data);
      if (currentHash !== payload.expectedSnapshotHash) {
        return NextResponse.json(
          { error: "ข้อมูลถูกแก้ไขโดยคนอื่นระหว่างนี้ กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง" },
          { status: 409 }
        );
      }
    }

    const nextValues: Record<string, string> = { ...record.data };
    const changes: { header: string; oldValue: string; newValue: string }[] = [];

    if (payload.installLocation !== undefined) {
      if (!snapshot.fields.installLocation) {
        return NextResponse.json(
          { error: "ชีตนี้ไม่มีคอลัมน์สถานที่ตั้ง — บันทึกไม่ได้" },
          { status: 400 }
        );
      }
      const header = snapshot.fields.installLocation;
      const oldValue = record.data[header] ?? "";
      const newValue = payload.installLocation.trim();
      nextValues[header] = newValue;
      if (oldValue !== newValue) changes.push({ header, oldValue, newValue });
    }

    if (payload.responsiblePerson !== undefined) {
      // Some sheets split ชื่อ-สกุล into separate คำนำหน้า / ชื่อ-นามสกุล
      // columns instead of one combined question (see fields.ts
      // resolveFields) — a single free-text name can't be split back into
      // those two cells reliably, so saving this field back is only
      // supported when the sheet uses one combined name column.
      if (!snapshot.fields.fullNameHeader) {
        return NextResponse.json(
          {
            error:
              "ชีตนี้แยกคอลัมน์คำนำหน้า/ชื่อ-นามสกุลออกจากกัน ระบบบันทึกชื่อผู้รับผิดชอบกลับเป็นข้อความเดียวไม่ได้ — แก้ไขได้เฉพาะตอนพิมพ์รายงานนี้เท่านั้น",
          },
          { status: 400 }
        );
      }
      const header = snapshot.fields.fullNameHeader;
      const oldValue = record.data[header] ?? "";
      const newValue = payload.responsiblePerson.trim();
      nextValues[header] = newValue;
      if (oldValue !== newValue) changes.push({ header, oldValue, newValue });
    }

    if (changes.length === 0) {
      return NextResponse.json({
        rowNumber,
        values: nextValues,
        snapshotHash: rowSnapshotHash(snapshot.headers, nextValues),
      });
    }

    await updateEquipmentRow(rowNumber, snapshot.headers, nextValues);

    const timestamp = new Date().toISOString();
    const department = snapshot.fields.department ? (record.data[snapshot.fields.department] ?? "") : "";
    const auditTag = requestAuditTag(request);
    for (const change of changes) {
      try {
        await appendEditLog({
          timestamp,
          action: "แก้ไข (IT)",
          actor: session.username,
          department,
          rowNumber,
          column: change.header,
          oldValue: change.oldValue,
          newValue: `${change.newValue} ${auditTag}`,
        });
      } catch (logErr: unknown) {
        console.error("appendEditLog failed:", logErr);
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
