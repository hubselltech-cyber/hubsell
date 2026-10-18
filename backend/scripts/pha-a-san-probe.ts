// ============================================================
// PHA A — KIỂM GIẢ THUYẾT LỚP GỌI SÀN (docs/CUNG-HOA-LOP-GOI-SAN.md mục 3)
// Chỉ ĐỌC sàn, không ghi bảng nghiệp vụ (chỉ làm mới token nếu hết hạn, như mọi
// probe khác). Mỗi giả thuyết một lệnh con, in số thật để điền bảng H1–H7.
//
//   cd backend
//   npx tsx scripts/pha-a-san-probe.ts h1 [tiktok_shop_id]   # TikTok tôn trọng sort_field=update_time?
//   npx tsx scripts/pha-a-san-probe.ts h2 [shopee_shop_id] [YYYY-MM-DD]  # đếm đơn 1 ngày qua get_order_list
//   npx tsx scripts/pha-a-san-probe.ts h6 [shopee_shop_id]   # số dư ví = 1 trang mới nhất?
//   npx tsx scripts/pha-a-san-probe.ts h5 [--keep]           # đo GCRA trong Postgres (DATABASE_URL hiện tại)
//
// h5 TẠO bảng + hàm tạm `_pha_a_gcra_*` trong DB đang nối rồi XÓA khi xong
// (giữ lại với --keep). Chạy trên Render shell = đo thật trên Supabase Micro.
// ============================================================

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { fetchOrders, type TikTokOrder } from "../src/integrations/tiktok/client";
import { getValidAccessToken as getTiktokAccess } from "../src/integrations/tiktok/service";
import {
  getOrderList,
  getWalletTransactionList,
  type ShopeeWalletTxn,
} from "../src/integrations/shopee/client";
import { getValidShopeeAccessToken } from "../src/integrations/shopee/service";

const iso = (sec: number) => new Date(sec * 1000).toISOString();
const fmt = (n: number) => Math.round(n).toLocaleString("vi-VN") + " ₫";
const DAY = 86_400;

// ---------- H1: TikTok orders/search có tôn trọng sort_field=update_time? ----------

function monotonic(values: number[], dir: "ASC" | "DESC"): { ok: boolean; violations: number } {
  let violations = 0;
  for (let i = 1; i < values.length; i++) {
    if (dir === "DESC" ? values[i] > values[i - 1] : values[i] < values[i - 1]) violations++;
  }
  return { ok: violations === 0, violations };
}

async function readTiktokPages(opts: {
  accessToken: string;
  shopCipher: string;
  from: number;
  to: number;
  pages: number;
  sortField?: "create_time" | "update_time";
}) {
  const all: TikTokOrder[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  let total: number | undefined;
  do {
    const d = await fetchOrders({
      accessToken: opts.accessToken,
      shopCipher: opts.shopCipher,
      updateTimeGe: opts.from,
      updateTimeLt: opts.to,
      pageSize: 100,
      pageToken,
      ...(opts.sortField ? { sortField: opts.sortField, sortOrder: "DESC" as const } : {}),
    });
    pages++;
    total = d.total_count ?? total;
    all.push(...(d.orders ?? []));
    pageToken = d.next_page_token || undefined;
  } while (pageToken && pages < opts.pages);
  return { all, pages, total, hasMore: Boolean(pageToken) };
}

async function h1(shopIdArg?: string) {
  const channels = await prisma.channel.findMany({
    where: {
      channelName: "TIKTOK",
      status: "ACTIVE",
      refreshToken: { not: null },
      shopCipher: { not: null },
      ...(shopIdArg ? { externalShopId: shopIdArg } : {}),
    },
    orderBy: { shopName: "asc" },
  });
  if (channels.length === 0) return console.log("❌ Không có gian TikTok đang nối.");
  const now = Math.floor(Date.now() / 1000);
  const from = now - 2 * DAY;
  for (const ch of channels) {
    console.log(`\n===== TikTok ${ch.shopName} (${ch.externalShopId}) — cửa sổ update_time 2 ngày =====`);
    try {
      const { accessToken, shopCipher } = await getTiktokAccess(ch);
      for (const sortField of ["update_time", undefined] as const) {
        const r = await readTiktokPages({ accessToken, shopCipher, from, to: now, pages: 3, sortField });
        const upd = r.all.map((o) => o.update_time ?? 0);
        const cre = r.all.map((o) => o.create_time ?? 0);
        const mUpd = monotonic(upd, "DESC");
        const mCre = monotonic(cre, "DESC");
        const outside = upd.filter((u) => u < from || u >= now).length;
        console.log(
          `  sort_field=${sortField ?? "(không gửi — như worker hiện tại)"}: ${r.pages} trang, ${r.all.length} đơn` +
            (r.total != null ? ` / total_count ${r.total}` : "") +
            (r.hasMore ? " (còn trang)" : "")
        );
        console.log(
          `    update_time giảm đơn điệu: ${mUpd.ok ? "ĐÚNG" : `SAI (${mUpd.violations} chỗ đảo)`} · create_time giảm đơn điệu: ${mCre.ok ? "ĐÚNG" : `SAI (${mCre.violations} chỗ đảo)`}`
        );
        if (upd.length) {
          console.log(
            `    update_time nhỏ nhất ${iso(Math.min(...upd))} · lớn nhất ${iso(Math.max(...upd))} · ngoài cửa sổ: ${outside} đơn (docs: "update times may exceed the selected range")`
          );
        }
      }
    } catch (err) {
      console.log("  ❌ lỗi:", err instanceof Error ? err.message : err);
    }
  }
}

// ---------- H2: Shopee get_order_list đọc hết trang có ĐỦ đơn một ngày? ----------

function vnDayRange(ymd?: string): { from: number; to: number; label: string } {
  // Ngày VN (UTC+7). Mặc định = hôm qua.
  const nowVn = new Date(Date.now() + 7 * 3600 * 1000);
  let y: number, m: number, d: number;
  if (ymd) {
    [y, m, d] = ymd.split("-").map(Number);
  } else {
    const yd = new Date(nowVn.getTime() - DAY * 1000);
    y = yd.getUTCFullYear();
    m = yd.getUTCMonth() + 1;
    d = yd.getUTCDate();
  }
  const startUtcMs = Date.UTC(y, m - 1, d) - 7 * 3600 * 1000;
  const from = Math.floor(startUtcMs / 1000);
  return { from, to: from + DAY - 1, label: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

async function readShopeeOrderList(opts: {
  accessToken: string;
  shopId: string;
  from: number;
  to: number;
  field: "create_time" | "update_time";
}) {
  const sns = new Map<string, string>(); // order_sn → status
  let cursor: string | undefined;
  let pages = 0;
  let dup = 0;
  do {
    const d = await getOrderList({
      accessToken: opts.accessToken,
      shopId: opts.shopId,
      timeFrom: opts.from,
      timeTo: opts.to,
      timeRangeField: opts.field,
      pageSize: 100,
      cursor,
    });
    pages++;
    for (const o of d.response?.order_list ?? []) {
      if (sns.has(o.order_sn)) dup++;
      sns.set(o.order_sn, o.order_status ?? "?");
    }
    cursor = d.response?.more ? d.response?.next_cursor || undefined : undefined;
  } while (cursor && pages < 200);
  return { sns, pages, dup, cut: Boolean(cursor) };
}

async function h2(shopIdArg?: string, ymd?: string) {
  const channels = await prisma.channel.findMany({
    where: {
      channelName: "SHOPEE",
      status: "ACTIVE",
      refreshToken: { not: null },
      ...(shopIdArg ? { externalShopId: shopIdArg } : {}),
    },
    orderBy: { shopName: "asc" },
  });
  if (channels.length === 0) return console.log("❌ Không có gian Shopee đang nối.");
  const day = vnDayRange(ymd);
  console.log(`Ngày VN ${day.label}: ${iso(day.from)} → ${iso(day.to)}`);
  for (const ch of channels) {
    console.log(`\n===== Shopee ${ch.shopName} (${ch.externalShopId}) =====`);
    try {
      const { accessToken, shopId } = await getValidShopeeAccessToken(ch);
      const byCreate = await readShopeeOrderList({ accessToken, shopId, ...day, field: "create_time" });
      const byStatus = new Map<string, number>();
      for (const s of byCreate.sns.values()) byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
      console.log(
        `  get_order_list create_time: ${byCreate.sns.size} đơn, ${byCreate.pages} trang, trùng ${byCreate.dup}${byCreate.cut ? " ⚠️ CẮT ở 200 trang" : ""}`
      );
      console.log(`    theo trạng thái: ${[...byStatus].map(([s, n]) => `${s}=${n}`).join(", ")}`);
      // Đối chiếu với DB (đơn Hubsell đã có, tạo trong ngày đó — gồm cả đơn từ webhook).
      const inDb = await prisma.order.findMany({
        where: { channelId: ch.id, createdAt: { gte: new Date(day.from * 1000), lte: new Date(day.to * 1000) } },
        select: { orderCode: true },
      });
      const dbSet = new Set(inDb.map((o) => o.orderCode));
      const apiOnly = [...byCreate.sns.keys()].filter((sn) => !dbSet.has(sn));
      const dbOnly = [...dbSet].filter((sn) => !byCreate.sns.has(sn));
      console.log(
        `  DB Hubsell cùng ngày: ${dbSet.size} đơn · chỉ API có: ${apiOnly.length}${apiOnly.length ? ` (${apiOnly.slice(0, 5).join(", ")}…)` : ""} · chỉ DB có: ${dbOnly.length}${dbOnly.length ? ` (${dbOnly.slice(0, 5).join(", ")}…)` : ""}`
      );
      console.log(`  → Anh so với Seller Center: Đơn hàng → lọc Ngày đặt ${day.label} (mọi trạng thái).`);
      const byUpdate = await readShopeeOrderList({ accessToken, shopId, ...day, field: "update_time" });
      console.log(`  (tham khảo) get_order_list update_time cùng ngày: ${byUpdate.sns.size} đơn, ${byUpdate.pages} trang`);
    } catch (err) {
      console.log("  ❌ lỗi:", err instanceof Error ? err.message : err);
    }
  }
}

// ---------- H6: số dư ví Shopee = current_balance giao dịch mới nhất của 1 trang mới nhất? ----------

function isTimeRangeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("time_invalid") || msg.includes("time period too large");
}

function latestBalance(list: ShopeeWalletTxn[]): { time: number; balance: number } | null {
  let best: { time: number; balance: number } | null = null;
  for (const t of list) {
    if (typeof t.current_balance !== "number") continue;
    const time = t.create_time ?? 0;
    if (!best || time > best.time) best = { time, balance: t.current_balance };
  }
  return best;
}

async function h6(shopIdArg?: string) {
  const channels = await prisma.channel.findMany({
    where: {
      channelName: "SHOPEE",
      status: "ACTIVE",
      refreshToken: { not: null },
      ...(shopIdArg ? { externalShopId: shopIdArg } : {}),
    },
    orderBy: { shopName: "asc" },
  });
  if (channels.length === 0) return console.log("❌ Không có gian Shopee đang nối.");
  const now = Math.floor(Date.now() / 1000);
  for (const ch of channels) {
    console.log(`\n===== Shopee ${ch.shopName} (${ch.externalShopId}) =====`);
    try {
      const { accessToken, shopId } = await getValidShopeeAccessToken(ch);

      // (a) CÁCH MỚI: một trang (40 dòng) của cửa sổ mới nhất, co dần nếu sàn chê.
      let win = 7 * DAY;
      let page0: ShopeeWalletTxn[] = [];
      let more = false;
      let calls = 0;
      for (;;) {
        try {
          const d = await getWalletTransactionList({
            accessToken,
            shopId,
            createTimeFrom: now - win,
            createTimeTo: now,
            pageNo: 0,
            pageSize: 40,
          });
          calls++;
          page0 = d.response?.transaction_list ?? [];
          more = Boolean(d.response?.more);
          break;
        } catch (err) {
          if (isTimeRangeError(err) && win > 6 * 3600) {
            win = Math.floor(win / 2);
            continue;
          }
          throw err;
        }
      }
      const times = page0.map((t) => t.create_time ?? 0);
      const order = monotonic(times, "DESC").ok ? "MỚI → CŨ" : monotonic(times, "ASC").ok ? "CŨ → MỚI ⚠️" : "KHÔNG THỨ TỰ ⚠️";
      const a = latestBalance(page0);
      console.log(
        `  (a) 1 trang mới nhất: cửa sổ ${win / 3600}h, ${page0.length} dòng${more ? " (còn trang)" : ""}, thứ tự ${order}, ${calls} lệnh` +
          ` → số dư ${a ? `${fmt(a.balance)} tại ${iso(a.time)}` : "— (không có current_balance)"}`
      );

      // (b) CÁCH CŨ (wallet.ts): quét 30 ngày cũ→mới, mọi trang, lấy current_balance của dòng mới nhất.
      const startFrom = now - 30 * DAY;
      let winSec = 7 * DAY;
      let winFrom = startFrom;
      let pages = 0;
      let fetched = 0;
      let b: { time: number; balance: number } | null = null;
      while (winFrom < now && pages < 200) {
        const winTo = Math.min(winFrom + winSec, now);
        let pageNo = 0;
        let hasMore = true;
        try {
          while (hasMore && pages < 200) {
            const d = await getWalletTransactionList({
              accessToken,
              shopId,
              createTimeFrom: winFrom,
              createTimeTo: winTo,
              pageNo,
              pageSize: 40,
            });
            pages++;
            const list = d.response?.transaction_list ?? [];
            fetched += list.length;
            const lb = latestBalance(list);
            if (lb && (!b || lb.time > b.time)) b = lb;
            hasMore = Boolean(d.response?.more);
            pageNo++;
          }
          winFrom = winTo;
        } catch (err) {
          if (isTimeRangeError(err) && winSec > 6 * 3600) {
            winSec = Math.floor(winSec / 2);
            continue;
          }
          throw err;
        }
      }
      console.log(
        `  (b) quét 30 ngày như hiện tại: ${pages} lệnh, ${fetched} giao dịch → số dư ${b ? `${fmt(b.balance)} tại ${iso(b.time)}` : "—"}`
      );
      const match = a && b && a.balance === b.balance;
      console.log(`  → H6 ${match ? "ĐẠT: khớp từng đồng" : "KHÔNG KHỚP ⚠️"} · tiết kiệm ${pages - calls} lệnh/lượt cho gian này`);
      console.log(`  → Anh so thêm với Số dư ví trên Seller Center → Tài chính → Số dư TK Shopee.`);
    } catch (err) {
      console.log("  ❌ lỗi:", err instanceof Error ? err.message : err);
    }
  }
}

// ---------- H5: GCRA trong Postgres chịu tải mục tiêu? ----------

const GCRA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS _pha_a_gcra_state (
  key    text PRIMARY KEY,
  tat_ms bigint NOT NULL
)`,
  // GCRA: tat = "theoretical arrival time". Một lượt = emission_ms; cho phép dồn tối đa burst lượt.
  `CREATE OR REPLACE FUNCTION _pha_a_gcra_try(p_key text, p_emission_ms int, p_burst int)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  now_ms  bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_tat   bigint;
  new_tat bigint;
BEGIN
  INSERT INTO _pha_a_gcra_state(key, tat_ms) VALUES (p_key, now_ms)
    ON CONFLICT (key) DO NOTHING;
  SELECT tat_ms INTO v_tat FROM _pha_a_gcra_state WHERE key = p_key FOR UPDATE;
  new_tat := GREATEST(v_tat, now_ms) + p_emission_ms;
  IF new_tat - now_ms > p_burst::bigint * p_emission_ms THEN
    RETURN false;
  END IF;
  UPDATE _pha_a_gcra_state SET tat_ms = new_tat WHERE key = p_key;
  RETURN true;
END $$`,
];

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function benchRound(
  db: PrismaClient,
  label: string,
  opts: { keys: number; concurrency: number; seconds: number; emissionMs: number; burst: number; paceMs?: number }
) {
  const lat: number[] = [];
  let allowed = 0;
  let denied = 0;
  let errors = 0;
  const end = Date.now() + opts.seconds * 1000;
  const pace = opts.paceMs ?? 0;
  const worker = async (w: number) => {
    let i = 0;
    // Giãn thời điểm bắt đầu để các luồng không cùng thức một nhịp (timer Windows ~15 ms gom luồng lại).
    if (pace) await new Promise((r) => setTimeout(r, Math.round((w * pace) / opts.concurrency)));
    while (Date.now() < end) {
      const key = `app:shopee×gian:${(w * 7919 + i++) % opts.keys}`;
      const t0 = process.hrtime.bigint();
      try {
        const r = await db.$queryRaw<{ ok: boolean }[]>`SELECT _pha_a_gcra_try(${key}, ${opts.emissionMs}::int, ${opts.burst}::int) AS ok`;
        if (r[0]?.ok) allowed++;
        else denied++;
      } catch {
        errors++;
      }
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      lat.push(ms);
      if (pace && ms < pace) await new Promise((r) => setTimeout(r, pace - ms));
    }
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: opts.concurrency }, (_, w) => worker(w)));
  const elapsed = (Date.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  console.log(
    `  ${label}: ${opts.concurrency} luồng × ${opts.keys} khóa${opts.paceMs ? `, nhịp ${opts.paceMs} ms/luồng` : ""}, ${opts.seconds}s → ${(lat.length / elapsed).toFixed(0)} lệnh/giây` +
      ` · p50 ${pct(lat, 50).toFixed(2)} ms · p95 ${pct(lat, 95).toFixed(2)} ms · p99 ${pct(lat, 99).toFixed(2)} ms · max ${lat[lat.length - 1]?.toFixed(1)} ms` +
      ` · cho ${allowed} / chặn ${denied}${errors ? ` / LỖI ${errors}` : ""}`
  );
  return { rps: lat.length / elapsed, p99: pct(lat, 99) };
}

async function h5(keep: boolean) {
  const url = process.env.DATABASE_URL;
  if (!url) return console.log("❌ Thiếu DATABASE_URL.");
  const host = url.replace(/^.*@/, "").replace(/\/.*$/, "");
  console.log(`DB: ${host}  (bảng/hàm tạm _pha_a_gcra_*${keep ? ", GIỮ LẠI" : ", xóa khi xong"})`);
  // Pool riêng 16 kết nối (pooler Supabase Micro cho ~15 ở chế độ transaction) — đo
  // độ trễ thật của lệnh, không đo thời gian chờ pool của Prisma mặc định.
  const db = new PrismaClient({
    datasources: { db: { url: url + (url.includes("?") ? "&" : "?") + "connection_limit=16" } },
  });
  try {
    for (const stmt of GCRA_STATEMENTS) await db.$executeRawUnsafe(stmt);
    const v = await db.$queryRaw<{ version: string }[]>`SELECT version()`;
    console.log(`  ${v[0]?.version.split(",")[0]}`);
    await benchRound(db, "khởi động", { keys: 50, concurrency: 4, seconds: 2, emissionMs: 1000, burst: 1_000_000 });
    // Mục tiêu docs: ~300 lệnh/giây ở 1 triệu đơn/ngày. Khóa app×gian: nhiều khóa, ít tranh chấp.
    const r1 = await benchRound(db, "tải mục tiêu (nhiều khóa)", { keys: 2000, concurrency: 10, seconds: 8, emissionMs: 1000, burst: 1_000_000 });
    // Khóa theo APP: mọi worker đụng MỘT dòng — ca xấu nhất, đẩy hết sức để thấy trần của row lock.
    const r2 = await benchRound(db, "một khóa nóng, hết sức", { keys: 1, concurrency: 10, seconds: 8, emissionMs: 1000, burst: 1_000_000 });
    // Cùng một khóa nhưng ở NHỊP THẬT 300 lệnh/giây (10 luồng × 30/giây) — đây là số để so tiêu chí p99.
    const r3 = await benchRound(db, "một khóa nóng, nhịp 300/giây", { keys: 1, concurrency: 10, seconds: 8, emissionMs: 1000, burst: 1_000_000, paceMs: 33 });
    // Trần thật: 3 lệnh/giây/khóa (APP_QPS=3 tự chọn) với 200 khóa → phần lớn bị chặn, đo chi phí lượt bị chặn.
    const r4 = await benchRound(db, "trần 3 lệnh/giây/khóa, 200 khóa", { keys: 200, concurrency: 10, seconds: 5, emissionMs: 333, burst: 3 });
    const target = 300;
    const okCap = r1.rps >= target && r2.rps >= target;
    const okLat = Math.max(r1.p99, r3.p99, r4.p99) < 5;
    console.log(
      `
  → H5 ${okCap && okLat ? "ĐẠT" : okCap ? "ĐẠT thông lượng, p99 ≥ 5 ms ⚠️" : "KHÔNG ĐẠT ⚠️"} trên ${host}: cần ≥ ${target} lệnh/giây và p99 < 5 ms ở nhịp thật (tiêu chí docs mục 3; lượt "hết sức" chỉ để thấy trần).`
    );
    console.log("  Lưu ý: số trên máy dev chỉ là mốc so sánh; số quyết định là lượt chạy trên Render shell (Supabase Micro).");
  } finally {
    if (!keep) {
      await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS _pha_a_gcra_try(text, int, int)");
      await db.$executeRawUnsafe("DROP TABLE IF EXISTS _pha_a_gcra_state");
    }
    await db.$disconnect();
  }
}

// ---------- main ----------

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    switch (cmd) {
      case "h1":
        await h1(rest[0]);
        break;
      case "h2":
        await h2(rest.find((a) => !/^\d{4}-\d{2}-\d{2}$/.test(a)), rest.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)));
        break;
      case "h6":
        await h6(rest[0]);
        break;
      case "h5":
        await h5(rest.includes("--keep"));
        break;
      default:
        console.log("Dùng: npx tsx scripts/pha-a-san-probe.ts h1|h2|h5|h6 [tham số]  (xem đầu tệp)");
    }
  } finally {
    await prisma.$disconnect();
  }
})();
