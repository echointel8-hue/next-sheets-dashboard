import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, canAccessItDashboard, verifySessionToken } from "@/lib/auth";
import { getReportSettings, updateReportSettings, type ReportSettings } from "@/lib/sheets";

/** True iff `next` only ever appends to `current` — same entries, same
 * order, for every index `current` already has. Used to enforce, server
 * side, that a non-bootstrap account (see the isBootstrap check below) can
 * grow รายการ "การดำเนินการ" but never reorder, rename, or remove an
 * already-saved entry — the UI already hides those controls (see
 * MaintenanceReportBuilder's canManageActionOptions), this is the actual
 * boundary in case that UI is ever bypassed. */
function isAppendOnly(current: string[], next: string[]): boolean {
  if (next.length < current.length) return false;
  return current.every((v, i) => next[i] === v);
}

// Always live — never worth caching, and this is a low-traffic settings
// screen, not a hot path.
export const dynamic = "force-dynamic";

function requireItAccess(request: NextRequest) {
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 }) };
  }
  if (!canAccessItDashboard(session)) {
    return {
      session: null,
      response: NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงหน้านี้" }, { status: 403 }),
    };
  }
  return { session, response: null };
}

/** Current report template text (org name, form title, ผู้รับทราบ
 * name/position) — falls back to sensible defaults if the ReportSettings
 * tab doesn't exist yet (see getReportSettings). */
export async function GET(request: NextRequest) {
  const { session, response } = requireItAccess(request);
  if (!session) return response;

  try {
    const settings = await getReportSettings();
    return NextResponse.json({ settings });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function readSettingsPayload(body: unknown): Partial<ReportSettings> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const stringKeys: Exclude<keyof ReportSettings, "actionOptions">[] = [
    "orgName",
    "maintenanceFormTitle",
    "fiscalYearLabel",
    "acknowledgerName",
    "acknowledgerPosition",
    "acknowledgerDepartment",
  ];
  const out: Partial<ReportSettings> = {};
  for (const key of stringKeys) {
    if (b[key] === undefined) continue;
    if (typeof b[key] !== "string") return null;
    out[key] = (b[key] as string).trim();
  }
  if (b.actionOptions !== undefined) {
    if (!Array.isArray(b.actionOptions) || !b.actionOptions.every((x) => typeof x === "string")) return null;
    const cleaned = (b.actionOptions as string[]).map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) return null;
    out.actionOptions = cleaned;
  }
  return out;
}

/** Updates one or more settings — requires the ReportSettings tab to
 * already exist (see updateReportSettings), unlike GET which tolerates a
 * missing tab by returning defaults. */
export async function PATCH(request: NextRequest) {
  const { session, response } = requireItAccess(request);
  if (!session) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
  }
  const updates = readSettingsPayload(body);
  if (!updates) {
    return NextResponse.json({ error: "ข้อมูลที่ส่งมาไม่ถูกต้อง" }, { status: 400 });
  }

  try {
    // Only the single env-configured bootstrap account may reorder, rename,
    // or remove an already-saved รายการ "การดำเนินการ" entry — everyone else
    // who can reach this route (it, or a superadmin created later through
    // /manage/users) may only append new ones to the end.
    if (updates.actionOptions !== undefined && !session.isBootstrap) {
      const current = await getReportSettings();
      if (!isAppendOnly(current.actionOptions, updates.actionOptions)) {
        return NextResponse.json(
          { error: "แก้ไขหรือลบรายการ \"การดำเนินการ\" ที่บันทึกไว้แล้วได้เฉพาะบัญชีผู้ดูแลระบบหลักเท่านั้น — เพิ่มรายการใหม่ต่อท้ายได้ตามปกติ" },
          { status: 403 }
        );
      }
    }

    const settings = await updateReportSettings(updates);
    return NextResponse.json({ settings });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
