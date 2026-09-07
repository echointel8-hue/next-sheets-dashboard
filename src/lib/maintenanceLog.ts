// The shared, dependency-free half of the MaintenanceLog tab support (see
// lib/sheets.ts's MaintenanceLog section comment for the full design
// rationale). Split out into its own pure module — like lib/specEvaluation.ts
// — purely so the "current status per machine" derivation is safe to import
// from client components (ITDashboard.tsx computes it in the browser from
// data the page already fetched, without a server round-trip); the actual
// Google Sheets read/write (getMaintenanceLog/appendMaintenanceLogEntry)
// stays in lib/sheets.ts, which re-exports this type for convenience.

export interface MaintenanceLogEntry {
  timestamp: string;
  assetNumber: string;
  recordedBy: string;
  /** Free-form "name: version; name: version" — see
   * splitSoftwareEntries/joinSoftwareEntries in fields.ts. */
  software: string;
  maintenanceDate: string;
  /** "" (not assessed this visit) | "ปกติ" | "ต่ำกว่ามาตรฐาน" — IT's own
   * judgment call, independent of (and shown alongside) the automatic
   * evaluateSpec() check against SpecStandards (lib/specEvaluation.ts). */
  manualSpecStatus: "" | "ปกติ" | "ต่ำกว่ามาตรฐาน";
  notes: string;
}

/** Latest entry per เลขครุภัณฑ์ (by timestamp), for "current status"
 * displays — everything else (full history) comes from getMaintenanceLog
 * directly. */
export function getLatestMaintenanceLogByAsset(
  entries: MaintenanceLogEntry[]
): Map<string, MaintenanceLogEntry> {
  const latest = new Map<string, MaintenanceLogEntry>();
  for (const entry of entries) {
    const existing = latest.get(entry.assetNumber);
    if (!existing || entry.timestamp > existing.timestamp) {
      latest.set(entry.assetNumber, entry);
    }
  }
  return latest;
}
