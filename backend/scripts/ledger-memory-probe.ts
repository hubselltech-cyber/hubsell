// ============================================================
// SỔ CÁI ĐƠN — đo bộ nhớ MỘT kết nối database khi ghi sổ theo lô
//
// Sự cố 30/09/2026 13:04: Supabase compute Micro hết bộ nhớ (swap 1 GB đầy) sau
// đợt dựng sổ. Nghi phạm: câu ghi sổ mỗi lô là một câu hàng nghìn tham số, chữ
// câu lệnh khác nhau gần như mỗi lô, và Prisma giữ lại các câu đã chuẩn bị cho
// TỪNG kết nối (statement_cache_size). Script này ép pool về 1 kết nối rồi ghi
// lại sổ của các đơn sẵn có theo lô, in bộ nhớ của chính kết nối đó
// (pg_backend_memory_contexts, hoặc bộ nhớ tiến trình backend nếu thiếu quyền)
// và số câu đang được giữ (pg_prepared_statements).
//
//   npx tsx scripts/ledger-memory-probe.ts [--chunks 80] [--size 100] [--style json|values]
//
// --style: cach ghi (services/order-ledger.ts LedgerWriteStyle) — mac dinh la cach dang dung;
// chay hai lan (values roi json) de so bo nho truoc va sau.
//
// CHỈ chạy trên DB dev (localhost): ghi lại dòng sổ với cùng giá trị, đổi
// computedAt. Postgres phải chạy cùng máy nếu đo qua hệ điều hành.
// ============================================================

import "../src/integrations/__tests__/load-env";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`Chỉ chạy trên DB dev (localhost) — DATABASE_URL đang trỏ ${host || "?"}`);
  }
  // Một kết nối duy nhất → câu đo chạy trên đúng kết nối vừa ghi sổ. Đặt TRƯỚC
  // khi nạp lib/prisma (resolveDatabaseUrl đọc env lúc nạp).
  process.env.DB_CONNECTION_LIMIT = "1";
  const { prisma } = await import("../src/lib/prisma");
  const { recomputeLedgerOrders, withLedgerWriteStyle } = await import("../src/services/order-ledger");
  const styleArg = arg("style");
  if (styleArg !== undefined && styleArg !== "json" && styleArg !== "values") throw new Error("--style chi nhan json | values");

  const chunks = Math.max(1, Number(arg("chunks") ?? 80) || 80);
  const size = Math.min(100, Math.max(1, Number(arg("size") ?? 100) || 100));

  // Bộ nhớ kết nối: ưu tiên pg_backend_memory_contexts (cần quyền pg_read_all_stats);
  // không có quyền thì đọc bộ nhớ riêng của tiến trình backend ở hệ điều hành
  // (Windows: PrivateMemorySize64; Linux: VmRSS) — Postgres chạy cùng máy.
  const useView = (
    await prisma.$queryRawUnsafe<{ ok: boolean }[]>(
      `SELECT has_table_privilege('pg_catalog.pg_backend_memory_contexts', 'SELECT') AS ok`
    )
  )[0].ok;
  const osMemoryMb = (pid: number): number => {
    try {
      if (process.platform === "win32") {
        const out = execFileSync(
          "powershell",
          ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).PrivateMemorySize64`],
          { encoding: "utf8" }
        );
        return Number(out.trim()) / 1048576;
      }
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      return Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? NaN) / 1024;
    } catch {
      return NaN;
    }
  };
  const measure = async () => {
    const r = await prisma.$queryRawUnsafe<{ pid: number; stmts: number; text_kb: number }[]>(`
      SELECT pg_backend_pid() AS pid,
             (SELECT count(*)::int FROM pg_prepared_statements) AS stmts,
             (SELECT coalesce(sum(length(statement)), 0)::float8 / 1024 FROM pg_prepared_statements) AS text_kb
    `);
    const mb = useView
      ? (
          await prisma.$queryRawUnsafe<{ mb: number }[]>(
            `SELECT sum(total_bytes)::float8 / 1048576 AS mb FROM pg_backend_memory_contexts`
          )
        )[0].mb
      : osMemoryMb(r[0].pid);
    return { ...r[0], mb, source: useView ? "pg" : "os" };
  };
  const line = (label: string, m: Awaited<ReturnType<typeof measure>>) =>
    console.log(
      `${label.padEnd(14)} pid=${m.pid} bo nho=${m.mb.toFixed(1)} MB (${m.source}) ` +
        `cau dang giu=${m.stmts} chu cau lenh=${Math.round(m.text_kb)} KB`
    );

  const ids = (
    await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "Order" ORDER BY "createdAt" DESC LIMIT ${chunks * size}`
    )
  ).map((r) => r.id);
  console.log(`Don lay duoc: ${ids.length} — lo ${size} don, toi da ${chunks} lo, cach ghi: ${styleArg ?? "mac dinh"}`);

  const before = await measure();
  line("truoc khi ghi", before);
  const t0 = Date.now();
  let written = 0;
  let lines = 0;
  let done = 0;
  for (let i = 0; i < ids.length; i += size) {
    const claims = ids.slice(i, i + size).map((orderId) => ({ orderId, dirtyAt: null }));
    const r = styleArg
      ? await withLedgerWriteStyle(styleArg, () => recomputeLedgerOrders(claims))
      : await recomputeLedgerOrders(claims);
    written += r.written;
    lines += r.lines;
    done += 1;
    if (done % 10 === 0) line(`sau ${done} lo`, await measure());
  }
  const after = await measure();
  line("ket thuc", after);
  console.log(
    `Da ghi ${written} don, ${lines} dong hang trong ${Math.round((Date.now() - t0) / 1000)}s — ` +
      `bo nho ket noi tang ${(after.mb - before.mb).toFixed(1)} MB`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
