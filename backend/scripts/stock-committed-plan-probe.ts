// ============================================================
// THỬ KẾ HOẠCH CÂU LỆNH CHO DẤU "ĐƠN ĐANG GIỮ" — kho chuẩn quốc tế, thiết kế lại lát 1
// (docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 14)
//
// Câu hỏi: khi số đơn "đã từng giữ" lớn dần (0,6 % → 50 % bảng đơn) mà số đơn ĐANG giữ vẫn chỉ
// vài trăm, Postgres ước lượng tập đang giữ bao nhiêu dòng và chọn đường đọc nào, với ba cách
// đánh dấu:
//   CU   hai cột: c_at IS NOT NULL AND s_at IS NULL           (đang chạy trên prod từ 12/11)
//   A    một cột: held_at IS NOT NULL (xóa về NULL lúc rời kho)
//   B    bảng nhỏ riêng chỉ chứa đơn đang giữ
// Kèm hai cách "chữa rẻ" cho CU: thống kê mở rộng mcv và thống kê theo biểu thức.
//
// Dựng trong schema riêng `exp_kho_plan` (bảng UNLOGGED, không đụng bảng thật), chạy xong tự xóa.
//
//   npx tsx scripts/stock-committed-plan-probe.ts [--rows 470000] [--fractions 0.0063,0.02,0.05,0.1,0.5]
//        [--held 424] [--due 0] [--hostile-channels] [--a-index channel] [--only A] [--keep]
//
// Hai câu "bản mới" của cách A là ĐÚNG dạng câu trong src/services/stock-committed.ts
// (pickSweepCandidates + bước khóa của sweepShippedBatch). Sửa câu ở đó thì sửa ở đây và chạy lại.
// --hostile-channels: nửa số gian đã ngắt / ngủ đông và vẫn có đơn cũ, đơn đang giữ chỉ nằm ở gian
// sống — ca xấu cho nhánh "gian không còn sống" (máy tưởng nửa tập đang giữ thuộc gian chết).
//
// CHỈ chạy trên database máy mình: từ chối mọi DATABASE_URL không trỏ localhost.
// ============================================================
import { prisma } from "../src/lib/prisma";

const SCHEMA = "exp_kho_plan";
/** Bảng đơn prod 15/11/2026: 939.972 dòng, 848 đơn đang giữ (docs mục 13.14). */
const PROD_ROWS = 939_972;
const PROD_HELD = 848;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function assertLocalDatabase(): void {
  let host = "";
  try {
    host = new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    // để trống → từ chối bên dưới
  }
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    throw new Error(`stock-committed-plan-probe chỉ chạy trên database máy mình — DATABASE_URL đang trỏ "${host || "không rõ"}"`);
  }
}

const exec = (sql: string) => prisma.$executeRawUnsafe(sql);

async function build(rows: number, fraction: number, held: number, due: number, hostile: boolean): Promise<void> {
  await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await exec(`CREATE SCHEMA ${SCHEMA}`);
  await exec(`CREATE UNLOGGED TABLE ${SCHEMA}.channel (id text PRIMARY KEY, status text NOT NULL, hibernated_at timestamp(3))`);
  // 285 gian sống có đơn (ch000–ch284) + 15 gian đã ngắt / ngủ đông KHÔNG có đơn → nhánh "gian không
  // còn hoạt động" của quét bù không khớp dòng nào (ca xấu nhất: không có việc mà vẫn phải tìm).
  await exec(`
    INSERT INTO ${SCHEMA}.channel
    SELECT 'ch' || lpad(g::text, 3, '0'),
           CASE WHEN ${hostile ? "g % 4 = 1" : "g >= 285 AND g % 2 = 0"} THEN 'DISCONNECTED' ELSE 'ACTIVE' END,
           CASE WHEN ${hostile ? "g % 4 = 3" : "g >= 285 AND g % 2 = 1"} THEN now() ELSE NULL END
    FROM generate_series(0, 299) g`);
  // Gian của một đơn. Thường: 285 gian sống. Ca xấu: đơn cũ rải cả 300 gian (gian lẻ là gian chết),
  // đơn đang giữ chỉ ở gian chẵn (sống).
  const channelExpr = hostile
    ? `CASE WHEN h THEN 2 * floor(150 * power(random(), 3))::int ELSE floor(300 * power(random(), 3))::int END`
    : `floor(285 * power(random(), 3))::int`;
  await exec(`
    CREATE UNLOGGED TABLE ${SCHEMA}.ord (
      id text PRIMARY KEY, channel_id text NOT NULL, shipping_status text NOT NULL,
      deducted_at timestamp(3), c_at timestamp(3), s_at timestamp(3), held_at timestamp(3), filler text)`);
  // id tăng theo thời gian (như cuid): đơn "đã từng giữ" là các đơn MỚI NHẤT, nằm cuối khóa chính.
  // Đơn đang giữ: cứ 3 đơn lấy 1 trong `held * 3` đơn mới nhất. Đơn cần quét bù (`due`): đơn đang
  // giữ mà trạng thái đã SHIPPING.
  const window = held * 3;
  const ever = Math.max(Math.round(rows * fraction), window);
  const dueStep = due > 0 ? Math.max(1, Math.floor(held / due)) : 0;
  await exec(`
    INSERT INTO ${SCHEMA}.ord
    SELECT 'c' || lpad(i::text, 24, '0'),
           'ch' || lpad((${channelExpr})::text, 3, '0'),
           CASE WHEN h AND ${dueStep} > 0 AND (i / 3) % ${dueStep || 1} = 0 THEN 'SHIPPING'
                WHEN h THEN (CASE WHEN i % 2 = 0 THEN 'PENDING' ELSE 'PROCESSED' END)
                WHEN random() < 0.15 THEN 'CANCELLED' ELSE 'DELIVERED' END,
           CASE WHEN e THEN t END,
           CASE WHEN e THEN t END,
           CASE WHEN e AND NOT h THEN t + interval '1 day' END,
           CASE WHEN h THEN t END,
           repeat('x', 430)
    FROM (
      SELECT i, i > ${rows - ever} AS e, (i > ${rows - window} AND i % 3 = 0) AS h,
             timestamp '2026-01-01' + (i * interval '20 seconds') AS t
      FROM generate_series(1, ${rows}) i) s`);
  await exec(`CREATE INDEX ord_channel_idx ON ${SCHEMA}.ord (channel_id)`);
  await exec(`CREATE INDEX ord_cu_idx ON ${SCHEMA}.ord (channel_id) WHERE c_at IS NOT NULL AND s_at IS NULL`);
  // --a-index channel: chỉ mục cách A chỉ có channel_id (như chỉ mục prod hôm nay). Mặc định
  // (channel_id, id): câu đọc một gian có ORDER BY id lấy thứ tự thẳng từ chỉ mục.
  const aCols = arg("a-index") === "channel" ? "channel_id" : "channel_id, id";
  await exec(`CREATE INDEX ord_a_idx ON ${SCHEMA}.ord (${aCols}) WHERE held_at IS NOT NULL`);
  await exec(`CREATE UNLOGGED TABLE ${SCHEMA}.held (order_id text PRIMARY KEY, channel_id text NOT NULL, committed_at timestamp(3) NOT NULL)`);
  await exec(`INSERT INTO ${SCHEMA}.held SELECT id, channel_id, held_at FROM ${SCHEMA}.ord WHERE held_at IS NOT NULL`);
  await exec(`CREATE INDEX held_channel_idx ON ${SCHEMA}.held (channel_id)`);
  // Nhật ký trừ kho: mỗi đơn đã từng giữ 1 dòng, cứ 3 đơn có thêm 1 dòng thứ hai.
  await exec(`CREATE UNLOGGED TABLE ${SCHEMA}.il (order_id text NOT NULL, product_id text NOT NULL, qty int NOT NULL)`);
  await exec(`
    INSERT INTO ${SCHEMA}.il
    SELECT o.id, 'p' || ((row_number() OVER ()) % 5000), -1 - (n % 2)
    FROM ${SCHEMA}.ord o CROSS JOIN generate_series(1, 2) n
    WHERE o.c_at IS NOT NULL AND (n = 1 OR right(o.id, 1) IN ('0', '3', '6'))`);
  await exec(`CREATE INDEX il_order_idx ON ${SCHEMA}.il (order_id)`);
  await exec(`ANALYZE ${SCHEMA}.channel`);
  await exec(`ANALYZE ${SCHEMA}.ord`);
  await exec(`ANALYZE ${SCHEMA}.held`);
  await exec(`ANALYZE ${SCHEMA}.il`);
}

type Design = "CU" | "A" | "B";

const PRED: Record<Exclude<Design, "B">, string> = {
  CU: `o.c_at IS NOT NULL AND o.s_at IS NULL`,
  A: `o.held_at IS NOT NULL`,
};
const LIVE = `c.status = 'ACTIVE' AND c.hibernated_at IS NULL`;

/** Bốn câu đọc tập "đơn đang giữ" — cùng hình dạng với services/stock-committed.ts. */
function queries(design: Design): Record<string, string> {
  const S = SCHEMA;
  if (design === "B") {
    return {
      "quét bù": `SELECT o.id, NOT (${LIVE}) FROM ${S}.held h JOIN ${S}.ord o ON o.id = h.order_id JOIN ${S}.channel c ON c.id = o.channel_id
        WHERE (o.shipping_status IN ('SHIPPING','DELIVERED') OR NOT (${LIVE})) ORDER BY o.id LIMIT 200 FOR UPDATE OF o SKIP LOCKED`,
      "đếm": `SELECT count(*), min(h.committed_at) FROM ${S}.held h`,
      "đối chiếu": `SELECT il.product_id, sum(-il.qty) FROM ${S}.held h JOIN ${S}.il il ON il.order_id = h.order_id AND il.qty < 0 GROUP BY 1`,
      "một gian": `SELECT h.order_id FROM ${S}.held h WHERE h.channel_id = 'ch000' ORDER BY h.order_id LIMIT 500 FOR UPDATE OF h`,
    };
  }
  const p = PRED[design];
  return {
    "quét bù": `SELECT o.id, NOT (${LIVE}) FROM ${S}.ord o JOIN ${S}.channel c ON c.id = o.channel_id
      WHERE ${p} AND (o.shipping_status IN ('SHIPPING','DELIVERED') OR NOT (${LIVE})) ORDER BY o.id LIMIT 200 FOR UPDATE OF o SKIP LOCKED`,
    // Hướng vá đã rút lại ở mục 13.14: gom tập đang giữ vào CTE MATERIALIZED trước rồi mới sắp xếp.
    "quét bù (CTE)": `WITH g AS MATERIALIZED (SELECT o.id, o.channel_id, o.shipping_status FROM ${S}.ord o WHERE ${p})
      SELECT g.id, NOT (${LIVE}) FROM g JOIN ${S}.channel c ON c.id = g.channel_id
      WHERE (g.shipping_status IN ('SHIPPING','DELIVERED') OR NOT (${LIVE})) ORDER BY g.id LIMIT 200`,
    // ĐÚNG dạng pickSweepCandidates (src/services/stock-committed.ts): không ORDER BY, không khóa.
    "quét bù bản mới: chọn": `WITH g AS MATERIALIZED (SELECT o.id, o.channel_id, o.shipping_status, o.s_at FROM ${S}.ord o WHERE ${p})
      SELECT g.id, NOT (${LIVE}) AS inactive FROM g JOIN ${S}.channel c ON c.id = g.channel_id
      WHERE ${design === "A" ? "g.s_at IS NULL AND " : ""}(g.shipping_status IN ('SHIPPING','DELIVERED') OR NOT (${LIVE})) LIMIT 200`,
    // ĐÚNG dạng bước khóa của sweepShippedBatch: khóa theo danh sách mã (__IDS__ = 200 mã đang giữ).
    "quét bù bản mới: khóa 200 mã": `SELECT o.id FROM ${S}.ord o WHERE o.id = ANY(__IDS__) AND ${p}${design === "A" ? " AND o.s_at IS NULL" : ""}
      ORDER BY o.id FOR UPDATE OF o SKIP LOCKED`,
    // Tách hai nhánh của quét bù, mỗi nhánh một câu, vẫn giữ ORDER BY id LIMIT ở cùng tầng.
    "quét bù: đã giao": `SELECT o.id FROM ${S}.ord o WHERE ${p} AND o.shipping_status IN ('SHIPPING','DELIVERED')
      ORDER BY o.id LIMIT 200 FOR UPDATE OF o SKIP LOCKED`,
    // Như trên nhưng bỏ ORDER BY (SKIP LOCKED không cần thứ tự khóa).
    "quét bù: đã giao, không ORDER BY": `SELECT o.id FROM ${S}.ord o WHERE ${p} AND o.shipping_status IN ('SHIPPING','DELIVERED')
      LIMIT 200 FOR UPDATE OF o SKIP LOCKED`,
    "quét bù: gian ngắt": `SELECT o.id FROM ${S}.channel c JOIN ${S}.ord o ON o.channel_id = c.id
      WHERE NOT (${LIVE}) AND ${p} ORDER BY o.id LIMIT 200 FOR UPDATE OF o SKIP LOCKED`,
    "đếm": `SELECT count(*), min(o.deducted_at) FROM ${S}.ord o WHERE ${p}`,
    "đối chiếu": `SELECT il.product_id, sum(-il.qty) FROM ${S}.ord o JOIN ${S}.il il ON il.order_id = o.id AND il.qty < 0 WHERE ${p} GROUP BY 1`,
    "một gian": `SELECT o.id FROM ${S}.ord o WHERE o.channel_id = 'ch000' AND ${p} ORDER BY o.id LIMIT 500 FOR UPDATE OF o`,
  };
}

interface PlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Plan Rows": number;
  "Actual Rows": number;
  "Actual Loops": number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  Plans?: PlanNode[];
}

interface Measured {
  /** Cách đọc bảng đơn (hoặc bảng nhỏ ở cách B): loại nút + chỉ mục. */
  access: string;
  /** Số dòng máy ước lượng ở nút đọc tập đang giữ. */
  est: number;
  actual: number;
  ms: number;
  /** Số khối 8 kB đã đụng (trong bộ đệm + đọc đĩa) — thước đo không phụ thuộc máy. */
  blocks: number;
}

const ROLLBACK = new Error("rollback");

async function measure(sql: string, randomPageCost: number): Promise<Measured> {
  let plan: { Plan: PlanNode; "Execution Time": number } | undefined;
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL random_page_cost = ${randomPageCost}`);
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '180s'`);
        const rows = await tx.$queryRawUnsafe<{ "QUERY PLAN": unknown }[]>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
        const raw = rows[0]["QUERY PLAN"];
        plan = (typeof raw === "string" ? JSON.parse(raw) : raw)[0];
        throw ROLLBACK; // nhả khóa FOR UPDATE
      },
      { timeout: 200_000, maxWait: 10_000 }
    );
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  if (!plan) throw new Error("không đọc được kế hoạch");
  const scans: PlanNode[] = [];
  const walk = (n: PlanNode) => {
    if (n["Relation Name"] === "ord" || n["Relation Name"] === "held" || n["Index Name"]?.startsWith("ord_") || n["Index Name"]?.startsWith("held_")) scans.push(n);
    n.Plans?.forEach(walk);
  };
  walk(plan.Plan);
  // Nút quyết định = nút đầu tiên đọc tập đang giữ (bảng nhỏ ở cách B, bảng đơn ở CU / A).
  const main = scans.find((s) => s["Relation Name"] === "held") ?? scans.find((s) => s["Relation Name"] === "ord") ?? scans[0];
  const access = [...new Set(scans.map((s) => `${s["Node Type"]}${s["Index Name"] ? ` ${s["Index Name"]}` : ""}`))].join(" + ");
  return {
    access,
    est: main?.["Plan Rows"] ?? -1,
    actual: main ? main["Actual Rows"] * main["Actual Loops"] : -1,
    ms: Math.round(plan["Execution Time"] * 10) / 10,
    blocks: (plan.Plan["Shared Hit Blocks"] ?? 0) + (plan.Plan["Shared Read Blocks"] ?? 0),
  };
}

async function main(): Promise<void> {
  assertLocalDatabase();
  const rows = Number(arg("rows") ?? 470_000);
  const fractions = (arg("fractions") ?? "0.0063,0.02,0.05,0.1,0.5").split(",").map(Number);
  const due = Number(arg("due") ?? 0);
  // --held: ép số đơn đang giữ (thử cỡ shop lớn); mặc định theo tỉ lệ prod.
  const held = Number(arg("held") ?? Math.round((PROD_HELD * rows) / PROD_ROWS));
  const keep = process.argv.includes("--keep");
  const hostile = process.argv.includes("--hostile-channels");
  const only = arg("only");
  const costs = (arg("costs") ?? "4,1.1").split(",").map(Number);
  console.log(
    `# ${rows} đơn, ${held} đơn đang giữ, ${due} đơn cần quét bù${hostile ? ", nửa số gian đã chết" : ""}; random_page_cost thử: ${costs.join(" và ")}`
  );

  for (const f of fractions) {
    await build(rows, f, held, due, hostile);
    // 200 mã đơn đang giữ cho câu khóa theo danh sách.
    const idRows = await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT order_id AS id FROM ${SCHEMA}.held LIMIT 200`);
    const idsLiteral = `ARRAY[${idRows.map((r) => `'${r.id}'`).join(",")}]::text[]`;
    const [size] = await prisma.$queryRawUnsafe<{ t: string; i: string }[]>(
      `SELECT pg_size_pretty(pg_relation_size('${SCHEMA}.ord')) AS t, pg_size_pretty(pg_indexes_size('${SCHEMA}.ord')) AS i`
    );
    console.log(`\n## Đã từng giữ ${(f * 100).toFixed(2)} % (bảng ${size.t}, chỉ mục ${size.i})`);
    console.log(`| Cách | Câu | rpc | Máy ước lượng | Thật | Đường đọc | Khối đụng | ms |`);
    console.log(`|---|---|---|---|---|---|---|---|`);
    const variants: { label: string; design: Design; before?: string; after?: string }[] = [
      { label: "CU", design: "CU" },
      {
        label: "CU + mcv",
        design: "CU",
        before: `CREATE STATISTICS ${SCHEMA}.st_mcv (mcv) ON c_at, s_at FROM ${SCHEMA}.ord`,
        after: `DROP STATISTICS ${SCHEMA}.st_mcv`,
      },
      {
        label: "CU + biểu thức",
        design: "CU",
        before: `CREATE STATISTICS ${SCHEMA}.st_expr ON ((c_at IS NOT NULL AND s_at IS NULL)) FROM ${SCHEMA}.ord`,
        after: `DROP STATISTICS ${SCHEMA}.st_expr`,
      },
      { label: "A", design: "A" },
      { label: "B", design: "B" },
    ];
    for (const v of variants) {
      if (only && v.label !== only) continue;
      if (v.before) {
        await exec(v.before);
        await exec(`ANALYZE ${SCHEMA}.ord`);
      }
      for (const [name, sql] of Object.entries(queries(v.design))) {
        for (const rpc of costs) {
          const m = await measure(sql.replace("__IDS__", idsLiteral), rpc);
          console.log(`| ${v.label} | ${name} | ${rpc} | ${m.est} | ${m.actual} | ${m.access} | ${m.blocks} | ${m.ms} |`);
        }
      }
      if (v.after) {
        await exec(v.after);
        await exec(`ANALYZE ${SCHEMA}.ord`);
      }
    }
  }
  if (!keep) await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
