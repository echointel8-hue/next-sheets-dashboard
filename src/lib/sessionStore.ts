// Durable, cross-instance store for "1 บัญชี 1 เซสชัน" (single active
// session per account — see lib/auth.ts's registerNewSession/
// isSessionSuperseded). This exists because of a real production bug: the
// feature used to live entirely in an in-memory Map inside lib/auth.ts, on
// the documented assumption that the app "deploys as a single always-on
// `next start` process." That assumption doesn't hold — this app actually
// runs on Vercel, which can (and does) run more than one serverless
// function instance for the same deployment at once, each with its own
// separate process memory. A plain in-memory Map never reliably sees the
// same state across every request once that happens, which showed up
// exactly as reported: logging in from a second device sometimes
// immediately kicked the *new* login itself back out (its very next request
// happened to land on an instance that still only knew about the old,
// stale sessionId), while the first device sometimes never got kicked out
// at all (its own later requests kept landing on instances that had no
// record of the new login yet). Moving this one piece of state into a
// small external key-value store that every instance reads/writes the same
// way fixes it for good.
//
// Backed by Upstash's REST API (https://upstash.com) — reachable over plain
// HTTPS with no persistent connection, which is what a serverless function
// needs (a normal TCP-connection-based Redis client doesn't suit this
// deployment shape well at all — it would open/close a fresh connection on
// every single invocation). Two ways to get the two env vars below:
//   - Vercel dashboard -> your project -> Storage tab -> "Upstash for
//     Redis" (a Marketplace integration) -> Create Database. Vercel wires
//     the matching environment variables into your project for you; just
//     rename/alias them to the two names below (or update the two lines
//     right under EnvConfig if you'd rather keep Vercel's own names).
//   - Or create a free database directly at https://upstash.com/ and copy
//     its "REST URL" / "REST TOKEN" from the database's dashboard.
// Set both in .env.local for local dev and in the Vercel project's
// Environment Variables for production:
//   SESSION_STORE_REDIS_URL   e.g. https://xxxxx.upstash.io
//   SESSION_STORE_REDIS_TOKEN the REST token for that database
//
// Deliberately optional at runtime, unlike getEnv("GOOGLE_SHEET_ID")
// elsewhere in this app — every function below no-ops / falls back instead
// of throwing when these two aren't set, so a deploy that hasn't configured
// this yet keeps behaving exactly like the old in-memory-only version
// (works correctly within a single instance's lifetime, same old tradeoff)
// rather than breaking the login flow outright. Once configured, every
// instance shares the exact same state and the single-session guarantee
// actually holds everywhere, all the time.

/** true เมื่อตั้งค่า SESSION_STORE_REDIS_URL/TOKEN ไว้แล้วทั้งคู่ — ใช้ทั้งใน
 * ไฟล์นี้เองและใน lib/auth.ts (checkSessionSuperseded) เพื่อรู้ว่าจะพึ่งพา
 * ที่เก็บกลางนี้ได้หรือต้องถอยไปใช้ Map ในหน่วยความจำแบบเดิม (ครอบคลุมแค่
 * instance เดียว) เป็นทางสำรอง — ดูคอมเมนต์ยาวด้านบนไฟล์นี้. */
export function isSessionStoreConfigured(): boolean {
  return !!process.env.SESSION_STORE_REDIS_URL && !!process.env.SESSION_STORE_REDIS_TOKEN;
}

/** One REST call to Upstash's path-style command API — e.g.
 * redisCommand(["SET", "foo", "bar", "EX", "60"]) or
 * redisCommand(["GET", "foo"]). Returns the raw `result` field, or throws on
 * a network/HTTP error — every caller below catches this and fails open
 * (never lets an Upstash hiccup break the actual login/session flow, same
 * "best effort" philosophy as this app's other external calls, e.g.
 * getUsers() failures during login in /api/auth/login/route.ts). */
async function redisCommand(args: (string | number)[]): Promise<unknown> {
  const url = process.env.SESSION_STORE_REDIS_URL;
  const token = process.env.SESSION_STORE_REDIS_TOKEN;
  if (!url || !token) return null;

  const path = args.map((a) => encodeURIComponent(String(a))).join("/");
  const res = await fetch(`${url.replace(/\/+$/, "")}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    // ไม่ต้อง cache ผลลัพธ์นี้เลย — สถานะเซสชันต้องเป็นค่าล่าสุดเสมอทุกครั้ง
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Upstash REST error (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const json = (await res.json()) as { result: unknown; error?: string };
  if (json.error) throw new Error(`Upstash REST error: ${json.error}`);
  return json.result;
}

// เก็บไว้นาน 7 วัน (วินาที) เป็นตาข่ายนิรภัยกันคีย์ค้างตลอดไปสำหรับบัญชีที่
// ถูกลบ/เปลี่ยนชื่อไปแล้ว — การ login จริงทุกครั้งเขียนทับค่านี้อยู่แล้วไม่ว่า
// กรณีไหน จึงไม่กระทบพฤติกรรมปกติเลย
const ACTIVE_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function activeSessionKey(username: string): string {
  return `ttk:activeSession:${username}`;
}

/** บันทึก sessionId ของบัญชีนี้เป็น "เซสชันที่ใช้งานอยู่" ตัวล่าสุด — เรียก
 * ครั้งเดียวตอน login สำเร็จ (registerNewSession ใน lib/auth.ts) เขียนทับ
 * ของเดิมเสมอไม่ว่าจะมีอะไรอยู่ก่อนหน้า — ทำงานแบบ best-effort เงียบๆ ถ้ายัง
 * ไม่ได้ตั้งค่า SESSION_STORE_REDIS_URL/TOKEN ไว้ (no-op) หรือ Upstash
 * เรียกไม่สำเร็จชั่วคราว (catch แล้วปล่อยผ่าน ไม่ทำให้ login ทั้งขั้นตอนพัง) */
export async function setActiveSessionId(username: string, sessionId: string): Promise<void> {
  try {
    await redisCommand(["SET", activeSessionKey(username), sessionId, "EX", ACTIVE_SESSION_TTL_SECONDS]);
  } catch (err: unknown) {
    console.error("sessionStore.setActiveSessionId failed:", err);
  }
}

/** true เมื่อบัญชีนี้มีเซสชันอื่นที่ใหม่กว่าถูกบันทึกไว้เป็น "เซสชันที่ใช้งาน
 * อยู่" แทนที่ sessionId ที่ส่งมา — เรียกจาก proxy.ts ทุกครั้งที่มีคุกกี้
 * เซสชันที่ผ่านการตรวจลายเซ็น/วันหมดอายุมาแล้ว (verifySessionTokenWithReason
 * ใน lib/auth.ts, เฉพาะ local check ไม่แตะที่เก็บนี้เลย) ก่อนปล่อยให้คำขอ
 * ผ่านไปหน้า/API จริง ถ้ายังไม่เคยมีการบันทึกอะไรไว้เลยสำหรับบัญชีนี้ (เช่น
 * เพิ่งตั้งค่า SESSION_STORE_* ใหม่ หรือคุกกี้เก่าที่มาจากก่อนฟีเจอร์นี้มีอยู่
 * แล้วในระบบ) จะ "รับเอา" sessionId นี้เป็นตัวที่ใช้งานอยู่แทน (adopt) ไม่ใช่
 * ปฏิเสธ — เหตุผลเดียวกับโค้ดเดิม: ดีกว่าบังคับทุกคน logout พร้อมกันตอนเพิ่ง
 * ตั้งค่าฟีเจอร์นี้ครั้งแรก ยังไม่บังคับความเป็น "1 เซสชัน" จริงจนกว่าจะมีการ
 * login ครั้งใหม่มาบันทึกทับ. ถ้ายังไม่ได้ตั้งค่า Redis ไว้เลย หรือเรียกไม่
 * สำเร็จชั่วคราว คืน false เสมอ (fail open — ไม่เตะใครออกเพราะเหตุผลที่ไม่
 * เกี่ยวกับตัวเขาเอง) ตรงกับพฤติกรรมเดิมก่อนมี Redis ทุกประการ. */
export async function isSessionSuperseded(username: string, sessionId: string): Promise<boolean> {
  if (!isSessionStoreConfigured()) return false;
  try {
    const current = await redisCommand(["GET", activeSessionKey(username)]);
    if (current === null || current === undefined) {
      // ยังไม่เคยมีการบันทึกไว้เลย — รับเอาตัวนี้เป็นเซสชันที่ใช้งานอยู่แทน
      await setActiveSessionId(username, sessionId);
      return false;
    }
    return current !== sessionId;
  } catch (err: unknown) {
    console.error("sessionStore.isSessionSuperseded failed:", err);
    return false;
  }
}

/** ล้างสถานะ "เซสชันที่ใช้งานอยู่" ของบัญชีนี้ — เรียกตอน logout ชัดเจน
 * (POST /api/auth/logout) หรือรีเซ็ตรหัสผ่านสำเร็จ (POST
 * /api/auth/reset-password, ซึ่งเตะทุกเซสชันเดิมของบัญชีนั้นออกอยู่แล้วเป็น
 * ปกติ) ไม่ใช่ขั้นตอนที่จำเป็นสำหรับกลไกเตะออกตอน login ใหม่เอง (login ครั้ง
 * ใหม่เขียนทับอยู่แล้วไม่ว่าจะมีอะไรอยู่ก่อนหน้า) แค่ความเรียบร้อยไม่ให้มีคีย์
 * ค้างเกินจำเป็น. */
export async function clearActiveSessionId(username: string): Promise<void> {
  try {
    await redisCommand(["DEL", activeSessionKey(username)]);
  } catch (err: unknown) {
    console.error("sessionStore.clearActiveSessionId failed:", err);
  }
}
