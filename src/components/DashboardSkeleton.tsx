// Renders instantly (no data dependency) so the page shell paints before the
// Google Sheets round-trip finishes — Dashboard streams in to replace this
// once DashboardData resolves. Pulses respect prefers-reduced-motion. Shape
// mirrors Dashboard's actual layout (icon badge header, filter card, 3 stat
// tiles, 2 breakdown charts, records card) so there's no visible reflow when
// data lands.
const PULSE = "animate-pulse rounded-2xl bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800";

export default function DashboardSkeleton() {
  return (
    <main
      id="main-content"
      aria-busy="true"
      aria-label="กำลังโหลดแดชบอร์ด"
      className="flex w-full flex-1 justify-center bg-[var(--page-bg)] px-4 py-8 sm:px-8 lg:px-12"
    >
      <div className="flex w-full max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-11 w-11 shrink-0 ${PULSE}`} />
            <div className="flex flex-col gap-2">
              <div className={`h-7 w-64 rounded-md ${PULSE}`} />
              <div className={`h-4 w-48 rounded-md ${PULSE}`} />
            </div>
          </div>
          <div className={`h-10 w-32 self-start rounded-full sm:self-auto ${PULSE}`} />
        </div>

        <div className={`h-24 ${PULSE}`} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className={`h-16 ${PULSE}`} />
          <div className={`h-16 ${PULSE}`} />
          <div className={`h-16 ${PULSE}`} />
        </div>

        <div className={`h-48 ${PULSE}`} />
        <div className={`h-48 ${PULSE}`} />
        <div className={`h-64 ${PULSE}`} />

        <span className="sr-only">กำลังโหลดข้อมูลจาก Google Sheets…</span>
      </div>
    </main>
  );
}
