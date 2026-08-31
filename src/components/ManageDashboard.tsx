"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Filter,
  LogOut,
  Package,
  PackageX,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  STATUS_DISPOSED,
  getBrandModel,
  getFullName,
  type EquipmentRow,
  type FieldMap,
} from "@/lib/fields";
import type { Role } from "@/lib/auth";
import EquipmentFormModal, { type EquipmentFormResult } from "@/components/EquipmentFormModal";
import MultiSelect from "@/components/MultiSelect";

export interface ManageRecord {
  rowNumber: number;
  values: EquipmentRow;
  snapshotHash: string;
}

export interface ManageData {
  headers: string[];
  fields: FieldMap;
  rows: ManageRecord[];
}

type ManageLoadResult = ManageData | { error: string };

function isError(data: ManageLoadResult): data is { error: string } {
  return "error" in data;
}

function cell(row: EquipmentRow, header: string | null): string {
  if (!header) return "";
  return (row[header] ?? "").trim();
}

/** Drops the time portion of a timestamp so the "ประทับเวลา" column stays
 * narrow — e.g. "27/7/2026, 11:20:58" -> "27/7/2026". Falls back to
 * stripping a trailing HH:MM(:SS) token for timestamps with no comma
 * (older rows use a few different formats), and returns the raw value
 * unchanged if neither pattern matches rather than mangling it. */
function dateOnly(raw: string): string {
  if (!raw) return "";
  const commaIndex = raw.indexOf(",");
  if (commaIndex !== -1) return raw.slice(0, commaIndex).trim();
  return raw.replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*$/, "").trim();
}

const CARD = "rounded-2xl border border-emerald-900/10 bg-white shadow-sm dark:border-emerald-400/10 dark:bg-zinc-900";
const ACTION_BUTTON =
  "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

interface ModalState {
  mode: "add" | "edit";
  rowNumber?: number;
  initialValues: Record<string, string>;
  snapshotHash?: string;
  readOnlyHeaders?: string[];
}

interface RowDisplay {
  disposed: boolean;
  department: string;
  fullName: string;
  assetNumber: string;
  equipmentType: string;
  timestamp: string;
  brandModel: string;
  installLocation: string;
  purchaseDate: string;
}

function rowDisplay(record: ManageRecord, fields: FieldMap | null): RowDisplay {
  return {
    disposed: fields ? cell(record.values, fields.status) === STATUS_DISPOSED : false,
    department: cell(record.values, fields?.department ?? null),
    fullName: (fields && getFullName(record.values, fields)) || "",
    assetNumber: cell(record.values, fields?.assetNumber ?? null),
    equipmentType: cell(record.values, fields?.equipmentType ?? null),
    timestamp: cell(record.values, fields?.timestamp ?? null),
    brandModel: (fields && getBrandModel(record.values, fields)) || "",
    installLocation: cell(record.values, fields?.installLocation ?? null),
    purchaseDate: cell(record.values, fields?.purchaseDate ?? null),
  };
}

export default function ManageDashboard({
  session,
  initial,
}: {
  session: { username: string; role: Role; department: string; isBootstrap: boolean };
  initial: ManageLoadResult;
}) {
  const router = useRouter();
  const [data, setData] = useState<ManageLoadResult>(initial);
  // Empty array = "all" (no filter on that dimension) — multi-select, same
  // as the public dashboard's filters, so an account can combine totals
  // across several departments and/or equipment types at once rather than
  // only ever narrowing to one value per dimension.
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [equipmentTypeFilter, setEquipmentTypeFilter] = useState<string[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [disposingRow, setDisposingRow] = useState<number | null>(null);
  const [restoringRow, setRestoringRow] = useState<number | null>(null);
  const [deletingRow, setDeletingRow] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isSuperadmin = session.role === "superadmin";

  const rows = useMemo(() => (!isError(data) ? data.rows : []), [data]);
  const headers = !isError(data) ? data.headers : [];
  const fields = !isError(data) ? data.fields : null;

  const departmentOptions = useMemo(() => {
    if (!fields) return [];
    const set = new Set<string>();
    for (const r of rows) {
      const v = cell(r.values, fields.department);
      if (v) set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "th")).map((value) => ({ value }));
  }, [rows, fields]);

  const equipmentTypeOptions = useMemo(() => {
    if (!fields) return [];
    const set = new Set<string>();
    for (const r of rows) {
      const v = cell(r.values, fields.equipmentType);
      if (v) set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "th")).map((value) => ({ value }));
  }, [rows, fields]);

  const hasActiveFilters = departmentFilter.length > 0 || equipmentTypeFilter.length > 0;

  function clearFilters() {
    setDepartmentFilter([]);
    setEquipmentTypeFilter([]);
  }

  const visibleRows = useMemo(() => {
    if (!fields) return [];
    return rows.filter((r) => {
      if (departmentFilter.length > 0) {
        const v = cell(r.values, fields.department);
        if (!departmentFilter.includes(v)) return false;
      }
      if (equipmentTypeFilter.length > 0) {
        const v = cell(r.values, fields.equipmentType);
        if (!equipmentTypeFilter.includes(v)) return false;
      }
      return true;
    });
  }, [rows, fields, departmentFilter, equipmentTypeFilter]);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  function openAdd() {
    if (!fields) return;
    const blank: Record<string, string> = {};
    for (const h of headers) blank[h] = "";
    setModal({ mode: "add", initialValues: blank });
  }

  function openEdit(record: ManageRecord) {
    if (!fields) return;
    const readOnlyHeaders =
      session.role === "admin" && fields.department ? [fields.department] : [];
    setModal({
      mode: "edit",
      rowNumber: record.rowNumber,
      initialValues: record.values,
      snapshotHash: record.snapshotHash,
      readOnlyHeaders,
    });
  }

  function handleSaved(result: EquipmentFormResult) {
    setData((prev) => {
      if (isError(prev)) return prev;
      const existingIndex = prev.rows.findIndex((r) => r.rowNumber === result.rowNumber);
      const nextRecord: ManageRecord = {
        rowNumber: result.rowNumber,
        values: result.values,
        snapshotHash: result.snapshotHash,
      };
      const nextRows =
        existingIndex === -1
          ? [nextRecord, ...prev.rows]
          : prev.rows.map((r, i) => (i === existingIndex ? nextRecord : r));
      return { ...prev, rows: nextRows };
    });
    setModal(null);
  }

  async function handleDispose(record: ManageRecord) {
    setActionError(null);
    setDisposingRow(record.rowNumber);
    try {
      const res = await fetch(`/api/manage/records/${record.rowNumber}/dispose`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setActionError(json.error ?? "จำหน่ายไม่สำเร็จ");
        return;
      }
      setData((prev) => {
        if (isError(prev)) return prev;
        return {
          ...prev,
          rows: prev.rows.map((r) =>
            r.rowNumber === record.rowNumber ? { ...r, values: json.values } : r
          ),
        };
      });
    } catch {
      setActionError("จำหน่ายไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setDisposingRow(null);
    }
  }

  async function handleRestore(record: ManageRecord) {
    setActionError(null);
    setRestoringRow(record.rowNumber);
    try {
      const res = await fetch(`/api/manage/records/${record.rowNumber}/restore`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setActionError(json.error ?? "ยกเลิกการจำหน่ายไม่สำเร็จ");
        return;
      }
      setData((prev) => {
        if (isError(prev)) return prev;
        return {
          ...prev,
          rows: prev.rows.map((r) =>
            r.rowNumber === record.rowNumber ? { ...r, values: json.values } : r
          ),
        };
      });
    } catch {
      setActionError("ยกเลิกการจำหน่ายไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setRestoringRow(null);
    }
  }

  async function handleDelete(record: ManageRecord) {
    const displayName = (fields && getFullName(record.values, fields)) || `แถวที่ ${record.rowNumber}`;
    const confirmed = window.confirm(
      `ยืนยันลบรายการ "${displayName}" ใช่หรือไม่?\n\nรายการนี้จะหายไปจากตารางและไม่ถูกนับในรายงานทันที ข้อมูลยังอยู่ในชีตเบื้องหลัง (ไม่ได้ลบถาวร) แต่จะกู้คืนผ่านหน้านี้ไม่ได้อีก`
    );
    if (!confirmed) return;

    setActionError(null);
    setDeletingRow(record.rowNumber);
    try {
      const res = await fetch(`/api/manage/records/${record.rowNumber}/delete`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setActionError(json.error ?? "ลบรายการไม่สำเร็จ");
        return;
      }
      setData((prev) => {
        if (isError(prev)) return prev;
        return { ...prev, rows: prev.rows.filter((r) => r.rowNumber !== record.rowNumber) };
      });
    } catch {
      setActionError("ลบรายการไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setDeletingRow(null);
    }
  }

  function actionButtons(record: ManageRecord, disposed: boolean) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => openEdit(record)}
          className={`${ACTION_BUTTON} border-emerald-900/15 text-emerald-700 hover:bg-emerald-50 focus-visible:outline-[var(--brand)] dark:border-emerald-400/20 dark:text-emerald-300 dark:hover:bg-emerald-900/20`}
        >
          <Pencil size={12} strokeWidth={2} aria-hidden="true" />
          แก้ไข
        </button>
        {isSuperadmin && !disposed && (
          <button
            type="button"
            onClick={() => handleDispose(record)}
            disabled={disposingRow === record.rowNumber}
            className={`${ACTION_BUTTON} border-red-200 text-red-700 hover:bg-red-50 focus-visible:outline-red-600 disabled:opacity-60 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30`}
          >
            <PackageX size={12} strokeWidth={2} aria-hidden="true" />
            จำหน่าย
          </button>
        )}
        {isSuperadmin && disposed && (
          <button
            type="button"
            onClick={() => handleRestore(record)}
            disabled={restoringRow === record.rowNumber}
            className={`${ACTION_BUTTON} border-amber-200 text-amber-700 hover:bg-amber-50 focus-visible:outline-amber-600 disabled:opacity-60 dark:border-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-950/30`}
          >
            <RotateCcw size={12} strokeWidth={2} aria-hidden="true" />
            ยกเลิกจำหน่าย
          </button>
        )}
        {session.isBootstrap && (
          <button
            type="button"
            onClick={() => handleDelete(record)}
            disabled={deletingRow === record.rowNumber}
            className={`${ACTION_BUTTON} border-zinc-300 text-zinc-500 hover:border-red-300 hover:bg-red-50 hover:text-red-700 focus-visible:outline-red-600 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-red-900/50 dark:hover:bg-red-950/30 dark:hover:text-red-300`}
          >
            <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
            ลบ
          </button>
        )}
      </div>
    );
  }

  return (
    <main className="flex w-full flex-1 justify-center bg-[var(--page-bg)] px-4 py-8 sm:px-6 lg:px-10">
      <div className="flex w-full max-w-[100rem] flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-950 dark:text-zinc-50 sm:text-2xl">
              จัดการข้อมูลครุภัณฑ์
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {session.username} ·{" "}
              {isSuperadmin ? "superadmin (ทุกกลุ่มงาน)" : `admin · ${session.department}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
              แดชบอร์ดสาธารณะ
            </Link>
            {session.isBootstrap && (
              <Link
                href="/manage/users"
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <Users size={16} strokeWidth={2} aria-hidden="true" />
                จัดการผู้ใช้
              </Link>
            )}
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-medium text-[var(--brand-contrast)] transition-colors hover:bg-[var(--brand-strong)]"
            >
              <LogOut size={16} strokeWidth={2} aria-hidden="true" />
              ออกจากระบบ
            </button>
          </div>
        </header>

        {isError(data) && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900 shadow-sm dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          >
            <AlertTriangle size={22} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p className="flex-1 text-base leading-7">{data.error}</p>
          </div>
        )}

        {actionError && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900 shadow-sm dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          >
            <AlertTriangle size={20} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p className="flex-1 text-base leading-7">{actionError}</p>
          </div>
        )}

        {!isError(data) && (
          <>
            {/* Filters — shown for every role, not just superadmin: an
                admin's rows are already scoped server-side to their own
                department (see /api/manage/records GET), but they can still
                narrow by equipment type and should see the same "N / M
                รายการ" count superadmin gets, not a plain sentence. */}
            <div className={`${CARD} flex flex-col gap-3 p-4`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-400 dark:text-zinc-500">
                  <Filter size={15} strokeWidth={2} aria-hidden="true" />
                  ตัวกรองข้อมูล
                </div>
                {isSuperadmin && (
                  <button
                    type="button"
                    onClick={openAdd}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-[var(--brand)] px-4 text-sm font-medium text-[var(--brand-contrast)] transition-colors hover:bg-[var(--brand-strong)]"
                  >
                    <Plus size={14} strokeWidth={2} aria-hidden="true" />
                    เพิ่มครุภัณฑ์ใหม่
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                {isSuperadmin && (
                  <MultiSelect
                    label="กลุ่มงาน"
                    options={departmentOptions}
                    selected={departmentFilter}
                    onChange={setDepartmentFilter}
                    className="sm:max-w-xs sm:flex-1"
                  />
                )}
                <MultiSelect
                  label="ประเภทครุภัณฑ์"
                  options={equipmentTypeOptions}
                  selected={equipmentTypeFilter}
                  onChange={setEquipmentTypeFilter}
                  className="sm:max-w-xs sm:flex-1"
                />
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="flex h-11 items-center justify-center gap-1 self-start rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 sm:self-auto"
                  >
                    <X size={16} strokeWidth={2} aria-hidden="true" />
                    ล้างตัวกรอง
                  </button>
                )}
                <span className="text-sm text-zinc-400 sm:ml-auto sm:self-center" aria-live="polite">
                  {visibleRows.length.toLocaleString("th-TH")} / {rows.length.toLocaleString("th-TH")} รายการ
                  {!isSuperadmin && "ในกลุ่มงานของคุณ"}
                </span>
              </div>
            </div>

            {/* Phones / narrow tablets: one card per record, stacked — a table
                with this many columns can never fit that width without either
                horizontal scrolling or unreadably small text, so below the
                sm breakpoint the table is replaced entirely rather than
                shrunk further. */}
            <div className={`${CARD} flex flex-col divide-y divide-zinc-100 p-3 sm:hidden dark:divide-zinc-800/60`}>
              {visibleRows.map((record) => {
                const d = rowDisplay(record, fields);
                return (
                  <div key={record.rowNumber} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {d.fullName || "—"}
                      </span>
                      {d.disposed ? (
                        <span className="inline-flex shrink-0 items-center rounded-full border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                          จำหน่ายแล้ว
                        </span>
                      ) : (
                        <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                          ใช้งาน
                        </span>
                      )}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      <div>
                        <dt className="text-zinc-400">ประทับเวลา</dt>
                        <dd className="text-zinc-700 dark:text-zinc-300">{dateOnly(d.timestamp) || "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-zinc-400">เลขครุภัณฑ์</dt>
                        <dd className="text-zinc-700 dark:text-zinc-300">{d.assetNumber || "—"}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-zinc-400">กลุ่มงาน</dt>
                        <dd className="text-zinc-700 dark:text-zinc-300">{d.department || "—"}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-zinc-400">ประเภทครุภัณฑ์</dt>
                        <dd className="text-zinc-700 dark:text-zinc-300">{d.equipmentType || "—"}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-zinc-400">ยี่ห้อ / รุ่น</dt>
                        <dd className="text-zinc-700 dark:text-zinc-300">{d.brandModel || "—"}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-zinc-400">สถานที่ / จุดติดตั้งอุปกรณ์</dt>
                        <dd className="text-zinc-700 dark:text-zinc-300">{d.installLocation || "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-zinc-400">วันที่จัดซื้อ</dt>
                        <dd className="text-zinc-700 dark:text-zinc-300">{d.purchaseDate || "—"}</dd>
                      </div>
                    </dl>
                    <div className="pt-1">{actionButtons(record, d.disposed)}</div>
                  </div>
                );
              })}
              {visibleRows.length === 0 && (
                <div className="flex flex-col items-center py-10 text-center text-zinc-400">
                  <Package size={22} strokeWidth={2} className="mb-2 opacity-60" aria-hidden="true" />
                  ไม่มีรายการ
                </div>
              )}
            </div>

            {/* sm and up: full table, sized to use the available width. */}
            <div className={`${CARD} hidden sm:block`}>
              <div className="max-w-full overflow-x-auto">
                <table className="w-full table-fixed text-left text-[11px] sm:text-xs lg:text-sm">
                  <colgroup>
                    <col className="w-[8%]" />
                    <col className="w-[10%]" />
                    <col className="w-[12%]" />
                    <col className="w-[8%]" />
                    <col className="w-[11%]" />
                    <col className="w-[12%]" />
                    <col className="w-[11%]" />
                    <col className="w-[8%]" />
                    <col className="w-[7%]" />
                    <col className="w-[13%]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-emerald-900/15 text-[10px] uppercase tracking-wide text-zinc-400 dark:border-emerald-400/15">
                      <th scope="col" className="px-2 py-2 font-medium sm:px-3">ประทับเวลา</th>
                      <th scope="col" className="px-2 py-2 font-medium sm:px-3">กลุ่มงาน</th>
                      <th scope="col" className="px-2 py-2 font-medium sm:px-3">ผู้ใช้งาน / ผู้รับผิดชอบ</th>
                      <th scope="col" className="px-2 py-2 font-medium sm:px-3">เลขครุภัณฑ์</th>
                      <th scope="col" className="px-2 py-2 font-medium sm:px-3">ประเภทครุภัณฑ์</th>
                      <th scope="col" className="px-2 py-2 font-medium sm:px-3">ยี่ห้อ / รุ่น</th>
                      <th scope="col" className="px-2 py-2 font-medium sm:px-3">สถานที่ / จุดติดตั้งอุปกรณ์</th>
                      <th scope="col" className="px-2 py-2 font-medium sm:px-3">วันที่จัดซื้อ</th>
                      <th scope="col" className="px-2 py-2 font-medium sm:px-3">สถานะ</th>
                      <th scope="col" className="px-2 py-2 font-medium sm:px-3">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((record) => {
                      const d = rowDisplay(record, fields);
                      return (
                        <tr
                          key={record.rowNumber}
                          className="border-b border-zinc-100 transition-colors last:border-0 hover:bg-emerald-50/70 dark:border-zinc-800/60 dark:hover:bg-emerald-900/10"
                        >
                          <td
                            className="whitespace-nowrap px-2 py-2 align-top leading-snug text-zinc-700 dark:text-zinc-300 sm:px-3"
                            title={d.timestamp || undefined}
                          >
                            {dateOnly(d.timestamp) || "—"}
                          </td>
                          <td
                            className="break-words px-2 py-2 align-top leading-snug text-zinc-700 dark:text-zinc-300 sm:px-3"
                            title={d.department || undefined}
                          >
                            {d.department || "—"}
                          </td>
                          <td
                            className="break-words px-2 py-2 align-top leading-snug font-medium text-zinc-900 dark:text-zinc-100 sm:px-3"
                            title={d.fullName || undefined}
                          >
                            {d.fullName || "—"}
                          </td>
                          <td
                            className="break-words px-2 py-2 align-top leading-snug text-zinc-700 dark:text-zinc-300 sm:px-3"
                            title={d.assetNumber || undefined}
                          >
                            {d.assetNumber || "—"}
                          </td>
                          <td
                            className="break-words px-2 py-2 align-top leading-snug text-zinc-700 dark:text-zinc-300 sm:px-3"
                            title={d.equipmentType || undefined}
                          >
                            {d.equipmentType || "—"}
                          </td>
                          <td
                            className="break-words px-2 py-2 align-top leading-snug text-zinc-700 dark:text-zinc-300 sm:px-3"
                            title={d.brandModel || undefined}
                          >
                            {d.brandModel || "—"}
                          </td>
                          <td
                            className="break-words px-2 py-2 align-top leading-snug text-zinc-700 dark:text-zinc-300 sm:px-3"
                            title={d.installLocation || undefined}
                          >
                            {d.installLocation || "—"}
                          </td>
                          <td
                            className="whitespace-nowrap px-2 py-2 align-top leading-snug text-zinc-700 dark:text-zinc-300 sm:px-3"
                            title={d.purchaseDate || undefined}
                          >
                            {d.purchaseDate || "—"}
                          </td>
                          <td className="px-2 py-2 align-top sm:px-3">
                            {d.disposed ? (
                              <span className="inline-flex items-center rounded-full border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                                จำหน่ายแล้ว
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                                ใช้งาน
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 align-top sm:px-3">{actionButtons(record, d.disposed)}</td>
                        </tr>
                      );
                    })}
                    {visibleRows.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-4 py-10 text-center text-zinc-400">
                          <Package size={22} strokeWidth={2} className="mx-auto mb-2 opacity-60" aria-hidden="true" />
                          ไม่มีรายการ
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {modal && !isError(data) && (
        <EquipmentFormModal
          mode={modal.mode}
          headers={headers}
          fields={data.fields}
          rowNumber={modal.rowNumber}
          initialValues={modal.initialValues}
          snapshotHash={modal.snapshotHash}
          readOnlyHeaders={modal.readOnlyHeaders}
          existingRows={rows}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </main>
  );
}
