import { createHash } from "crypto";

/**
 * Deterministic fingerprint of a row's values, in header order. Sent to the
 * client whenever a row is loaded for editing and echoed back on save so
 * the server can detect (and reject with 409) a write against stale data —
 * the underlying sheet can change at any time (another admin's edit, a
 * dispose, a new form submission) while someone has a row open to edit.
 */
export function rowSnapshotHash(headers: string[], data: Record<string, string>): string {
  const ordered = headers.map((h) => data[h] ?? "");
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}
