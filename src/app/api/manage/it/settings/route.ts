import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, canAccessItDashboard, verifySessionToken } from "@/lib/auth";
import { getReportSettings, updateReportSettings, type ReportSettings } from "@/lib/sheets";

/** True iff the two lists are identical, entry for entry. The client
 * (MaintenanceReportBuilder's saveSettingsAsDefault) always sends the full
 * ReportSettings object on every save — including actionOptions and
 * hiddenActionOptions — even when someone only edited, say, orgName, so
 * this route can't treat "the field was present in the request" as "the
 * field was meant to change". Used below to let a non-bootstrap account's
 * save through as long as it leaves รายการ "การดำเนินการ" (both which
 * items exist and which are ซ่อน/hidden) exactly as it already was. */
function sameStringList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
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
  const stringKeys: Exclude<
    keyof ReportSettings,
    "actionOptions" | "hiddenActionOptions" | "detailRequiredActionOptions"
  >[] = [
    "orgName",
    "maintenanceFormTitle",
    "fiscalYearLabel",
    "acknowledgerName",
    "acknowledgerPosition",
    "acknowledgerDepartment",
    "printFontSizePt",
    "printHeaderFontSizePt",
    "printTableFontSizePx",
    "printLineHeight",
  ];
  const out: Partial<ReportSettings> = {};
  for (const key of stringKeys) {
    if (b[key] === undefined) continue;
    if (typeof b[key] !== "string") return null;
    out[key] = (b[key] as string).trim();
  }
  // Each of these has to actually parse to a sane size/offset for
  // MaintenanceReportBuilder's inline styles — reject the save rather
  // than let any of them through broken.
  if (out.printFontSizePt !== undefined) {
    const n = Number(out.printFontSizePt);
    if (!Number.isFinite(n) || n < 8 || n > 36) return null;
  }
  if (out.printHeaderFontSizePt !== undefined) {
    const n = Number(out.printHeaderFontSizePt);
    // Same 8–36 range as printFontSizePt — kept in sync deliberately.
    if (!Number.isFinite(n) || n < 8 || n > 36) return null;
  }
  if (out.printTableFontSizePx !== undefined) {
    const n = Number(out.printTableFontSizePx);
    // Same 7–20px range MaintenanceReportBuilder's printTableFontSizePx
    // helper clamps to at render time — kept in sync deliberately.
    if (!Number.isFinite(n) || n < 7 || n > 20) return null;
  }
  if (out.printLineHeight !== undefined) {
    const n = Number(out.printLineHeight);
    // Same 0.7–2.5 range MaintenanceReportBuilder's printLineHeight helper
    // clamps to at render time — kept in sync deliberately.
    if (!Number.isFinite(n) || n < 0.7 || n > 2.5) return null;
  }
  if (b.actionOptions !== undefined) {
    if (!Array.isArray(b.actionOptions) || !b.actionOptions.every((x) => typeof x === "string")) return null;
    const cleaned = (b.actionOptions as string[]).map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) return null;
    out.actionOptions = cleaned;
  }
  if (b.hiddenActionOptions !== undefined) {
    if (!Array.isArray(b.hiddenActionOptions) || !b.hiddenActionOptions.every((x) => typeof x === "string")) return null;
    // No non-empty floor here, unlike actionOptions — "nothing hidden" is
    // a perfectly normal, common state.
    out.hiddenActionOptions = (b.hiddenActionOptions as string[]).map((s) => s.trim()).filter(Boolean);
  }
  if (b.detailRequiredActionOptions !== undefined) {
    if (
      !Array.isArray(b.detailRequiredActionOptions) ||
      !b.detailRequiredActionOptions.every((x) => typeof x === "string")
    )
      return null;
    // Same "no non-empty floor" as hiddenActionOptions — "nothing flagged"
    // is a perfectly normal, common state.
    out.detailRequiredActionOptions = (b.detailRequiredActionOptions as string[]).map((s) => s.trim()).filter(Boolean);
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
    // Only the single env-configured bootstrap account may touch รายการ
    // "การดำเนินการ" at all — add a new one, reorder/rename/remove an
    // already-saved one, ซ่อน/แสดง (hide/show) one, or flag one as needing
    // an IT free-text detail. Everyone else who can reach this route (it,
    // or a superadmin created later through /manage/users) may still
    // update every other setting here (org name, form title, ผู้รับทราบ,
    // ...) — the client always sends actionOptions/hiddenActionOptions/
    // detailRequiredActionOptions along with those (see sameStringList
    // above), so only reject when one of them would actually change; the
    // UI already hides its "+ เพิ่มรายการ"/hide-toggle/detail-toggle
    // controls and renders every entry read-only for a non-bootstrap
    // account (see MaintenanceReportBuilder's canManageActionOptions) —
    // this is the actual boundary in case that UI is ever bypassed.
    if (
      !session.isBootstrap &&
      (updates.actionOptions !== undefined ||
        updates.hiddenActionOptions !== undefined ||
        updates.detailRequiredActionOptions !== undefined)
    ) {
      const current = await getReportSettings();
      const actionOptionsChanged =
        updates.actionOptions !== undefined && !sameStringList(current.actionOptions, updates.actionOptions);
      const hiddenChanged =
        updates.hiddenActionOptions !== undefined &&
        !sameStringList(current.hiddenActionOptions, updates.hiddenActionOptions);
      const detailRequiredChanged =
        updates.detailRequiredActionOptions !== undefined &&
        !sameStringList(current.detailRequiredActionOptions, updates.detailRequiredActionOptions);
      if (actionOptionsChanged || hiddenChanged || detailRequiredChanged) {
        return NextResponse.json(
          { error: "จัดการรายการ \"การดำเนินการ\" ได้เฉพาะบัญชีผู้ดูแลระบบหลักเท่านั้น" },
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
