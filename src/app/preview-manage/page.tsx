import ManageDashboard, { type ManageData } from "@/components/ManageDashboard";
import { resolveFields, STATUS_ACTIVE, type EquipmentRow } from "@/lib/fields";

const HEADERS = [
  "ประทับเวลา",
  "ข้อมูลกลุ่มงาน / งานที่สังกัด",
  "เลขครุภัณฑ์โรงพยาบาล / เลขพัสดุ",
  "คำนำหน้า+ชื่อ-นามสกุล (ผู้ใช้งานหลัก / ผู้รับผิดชอบครุภัณฑ์)",
  "ประเภทครุภัณฑ์",
  "ยี่ห้อ (System Manufacturer) - C",
  "รุ่น (System Model) - C",
  "หน่วยประมวลผล (Processor)",
  "ประเภทของหน่วยจัดเก็บข้อมูล (Storage Type)",
  "ขนาดความจุรวมของพื้นที่จัดเก็บข้อมูล (Capacity)",
  "ประเภทของ RAM (RAM Type)",
  "ความจุของ RAM (RAM Capacity)",
  "ความเร็วของ RAM (RAM Speed)",
  "วัตถุประสงค์หลักในการใช้งานคอมพิวเตอร์ของคุณคืออะไร?",
  "ยี่ห้อ (System Manufacturer) - P",
  "รุ่น (System Model) - P",
  "ประเภทเครื่องพิมพ์",
  "วันที่จัดซื้อ",
  "สถานที่ / จุดติดตั้งอุปกรณ์",
  "สถานะ",
];

const DEPARTMENTS = [
  "กลุ่มงานบริหารทั่วไป",
  "งานแผนงานและยุทธศาสตร์และงานสื่อสารองค์กร",
  "กลุ่มงานเภสัชกรรมและคุ้มครองผู้บริโภค",
  "กลุ่มงานทันตกรรม",
];

const TYPES = [
  "ชุดคอมพิวเตอร์ตั้งโต๊ะ (Desktop PC)",
  "เครื่องพิมพ์ / ปริ้นเตอร์ (Printer)",
  "คอมพิวเตอร์พกพา (Notebook / Laptop)",
  "คอมพิวเตอร์แบบ All-in-One (AIO)",
];

const NAMES = ["นาง นางขนันธ์ ใจดีมาก", "นาย พัฒนา สุขสวัสดิ์", "นางสาว ปิยะธิดา แสงทอง"];

function buildRows(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const data: EquipmentRow = {};
    for (const h of HEADERS) data[h] = "";
    data["ประทับเวลา"] = `${1 + (i % 28)}/${1 + (i % 12)}/2026 09:${String(10 + i).padStart(2, "0")}:00`;
    data["ข้อมูลกลุ่มงาน / งานที่สังกัด"] = DEPARTMENTS[i % DEPARTMENTS.length];
    data["เลขครุภัณฑ์โรงพยาบาล / เลขพัสดุ"] = `คษ.08-000-${1000 + i}`;
    data["คำนำหน้า+ชื่อ-นามสกุล (ผู้ใช้งานหลัก / ผู้รับผิดชอบครุภัณฑ์)"] = NAMES[i % NAMES.length];
    data["ประเภทครุภัณฑ์"] = TYPES[i % TYPES.length];
    data["ยี่ห้อ (System Manufacturer) - C"] = "Dell";
    data["รุ่น (System Model) - C"] = "OptiPlex 3090";
    data["วันที่จัดซื้อ"] = "2026-05-01";
    data["สถานที่ / จุดติดตั้งอุปกรณ์"] = "ห้องธุรการ ชั้น 2";
    data["สถานะ"] = STATUS_ACTIVE;
    return { rowNumber: i + 2, values: data, snapshotHash: `hash-${i}` };
  });
}

const fields = resolveFields(HEADERS);

const manageData: ManageData = {
  headers: HEADERS,
  fields,
  rows: buildRows(6),
};

export default async function PreviewManagePage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const resolvedParams = await searchParams;
  const role = resolvedParams?.role === "admin" ? "admin" : "superadmin";
  const session =
    role === "admin"
      ? {
          username: "admin_biharn",
          displayName: "นางสาวทดสอบ ระบบพรีวิว",
          role: "admin" as const,
          department: "กลุ่มงานบริหารทั่วไป",
          isBootstrap: false,
        }
      : {
          username: "superadmin",
          displayName: "ผู้ดูแลระบบ (พรีวิว)",
          role: "superadmin" as const,
          department: "",
          isBootstrap: true,
        };

  const scopedData: ManageData =
    role === "admin"
      ? { ...manageData, rows: manageData.rows.filter((r) => r.values["ข้อมูลกลุ่มงาน / งานที่สังกัด"] === session.department) }
      : manageData;

  return <ManageDashboard session={session} initial={scopedData} />;
}
