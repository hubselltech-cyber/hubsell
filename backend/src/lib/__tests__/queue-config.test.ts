import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_QUEUES,
  DEAD_QUEUES,
  DEFAULT_EVT_ORDER_CONCURRENCY,
  DEFAULT_NOTIFY_POLL_SECONDS,
  DEFAULT_INVOICE_AUTO_ADJUST_MODE,
  DEFAULT_INVOICE_REQUEST_SWEEP_SECONDS,
  DEFAULT_INVOICE_SINGLE_WAIT_SECONDS,
  DEFAULT_STOCK_CHANNEL_CONCURRENCY,
  DEFAULT_STOCK_SWEEP_SECONDS,
  DEFAULT_WORKER_POOL_MAX,
  EVT_ORDER_MAX_ATTEMPTS,
  evtOrderConcurrency,
  invoiceAutoAdjustMode,
  invoiceRequestSweepSeconds,
  invoiceSingleWaitMs,
  listenNotifyEnabled,
  notifyPollSeconds,
  POLL_FAST_SECONDS,
  POLL_MANUAL_SECONDS,
  POLL_SLOW_SECONDS,
  queueOptionsForRole,
  resolveQueueConnection,
  stockChannelConcurrency,
  stockSweepSeconds,
} from "../queue-config";

const SUPABASE =
  "postgresql://postgres.abc:p%2Fw%2Ass@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&connection_limit=5&pool_timeout=30&statement_cache_size=0";

describe("resolveQueueConnection", () => {
  it("bỏ tham số riêng của Prisma, giữ nguyên mật khẩu đã mã hóa URL, bật TLS không kiểm chứng chỉ", () => {
    const c = resolveQueueConnection({ DATABASE_URL: SUPABASE })!;
    expect(c.connectionString).toBe(
      "postgresql://postgres.abc:p%2Fw%2Ass@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
    );
    expect(c.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("database trên máy mình: không TLS, bỏ ?schema=public", () => {
    const c = resolveQueueConnection({
      DATABASE_URL: "postgresql://hubsell:pw@localhost:5432/hubsell?schema=public",
    })!;
    expect(c.connectionString).toBe("postgresql://hubsell:pw@localhost:5432/hubsell");
    expect(c.ssl).toBeUndefined();
  });

  it("sslmode=disable tắt TLS kể cả với máy chủ ở xa", () => {
    const c = resolveQueueConnection({ DATABASE_URL: "postgresql://u:p@db.internal:5432/x?sslmode=disable" })!;
    expect(c.ssl).toBeUndefined();
  });

  it("QUEUE_DATABASE_URL thắng DATABASE_URL (trỏ pg-boss sang cổng 6543 không sửa mã)", () => {
    const c = resolveQueueConnection({
      DATABASE_URL: SUPABASE,
      QUEUE_DATABASE_URL: SUPABASE.replace(":5432/", ":6543/"),
    })!;
    expect(c.connectionString).toContain(":6543/postgres");
  });

  it("thiếu / sai chuỗi kết nối thì trả null", () => {
    expect(resolveQueueConnection({})).toBeNull();
    expect(resolveQueueConnection({ DATABASE_URL: "not a url" })).toBeNull();
    expect(resolveQueueConnection({ DATABASE_URL: "file:./dev.db" })).toBeNull();
  });
});

describe("queueOptionsForRole", () => {
  it("web chỉ gửi: 1 kết nối, không giám sát, không nhận việc", () => {
    expect(queueOptionsForRole("web", { QUEUE_POOL_MAX: "9" })).toEqual({
      max: 1,
      supervise: false,
      consumes: false,
      listenNotify: false,
    });
  });

  it("worker và all giám sát + nhận việc + nghe NOTIFY; QUEUE_POOL_MAX sai thì về mặc định", () => {
    expect(queueOptionsForRole("worker", {})).toEqual({
      max: DEFAULT_WORKER_POOL_MAX,
      supervise: true,
      consumes: true,
      listenNotify: true,
    });
    expect(queueOptionsForRole("worker", { QUEUE_LISTEN_NOTIFY: "off" }).listenNotify).toBe(false);
    expect(queueOptionsForRole("all", { QUEUE_POOL_MAX: "4" }).max).toBe(4);
    expect(queueOptionsForRole("worker", { QUEUE_POOL_MAX: "0" }).max).toBe(DEFAULT_WORKER_POOL_MAX);
    expect(queueOptionsForRole("worker", { QUEUE_POOL_MAX: "abc" }).max).toBe(DEFAULT_WORKER_POOL_MAX);
  });
});

describe("nhịp hỏi việc (08/10/2026, băng thông Render)", () => {
  it("ba mức nhịp: đơn + tồn 1 giây, chậm 5 giây, hóa đơn bấm tay giữ 0,5 (mức thấp nhất pg-boss)", () => {
    expect(POLL_FAST_SECONDS).toBe(1);
    expect(POLL_SLOW_SECONDS).toBe(5);
    expect(POLL_MANUAL_SECONDS).toBe(0.5);
  });

  it("QUEUE_LISTEN_NOTIFY mặc định bật; off / 0 / false là tắt", () => {
    expect(listenNotifyEnabled({})).toBe(true);
    expect(listenNotifyEnabled({ QUEUE_LISTEN_NOTIFY: "on" })).toBe(true);
    expect(listenNotifyEnabled({ QUEUE_LISTEN_NOTIFY: "off" })).toBe(false);
    expect(listenNotifyEnabled({ QUEUE_LISTEN_NOTIFY: "0" })).toBe(false);
    expect(listenNotifyEnabled({ QUEUE_LISTEN_NOTIFY: "FALSE" })).toBe(false);
  });

  it("QUEUE_NOTIFY_POLL_SECONDS trong 0,5–3600, sai thì về mặc định 30", () => {
    expect(notifyPollSeconds({})).toBe(DEFAULT_NOTIFY_POLL_SECONDS);
    expect(DEFAULT_NOTIFY_POLL_SECONDS).toBe(30);
    expect(notifyPollSeconds({ QUEUE_NOTIFY_POLL_SECONDS: "10" })).toBe(10);
    expect(notifyPollSeconds({ QUEUE_NOTIFY_POLL_SECONDS: "0.4" })).toBe(DEFAULT_NOTIFY_POLL_SECONDS);
    expect(notifyPollSeconds({ QUEUE_NOTIFY_POLL_SECONDS: "abc" })).toBe(DEFAULT_NOTIFY_POLL_SECONDS);
  });

  it("migration queue_notify bật cờ cho đúng các hàng đợi worker đang nhận (không có stock.dead)", () => {
    const sql = fs.readFileSync(
      path.join(__dirname, "../../../prisma/migrations/20261008100000_queue_notify/migration.sql"),
      "utf8"
    );
    for (const name of ["evt.order", "evt.auth", "evt.dead", "stock.channel", "stock.verify", "invoice.issue"]) {
      expect(sql).toContain(`'${name}'`);
    }
    expect(sql).not.toContain("'stock.dead'");
    expect(sql).toMatch(/SET notify = true/);
  });
});

describe("evtOrderConcurrency", () => {
  it("đọc QUEUE_EVT_ORDER_CONCURRENCY, sai thì về mặc định", () => {
    expect(evtOrderConcurrency({})).toBe(DEFAULT_EVT_ORDER_CONCURRENCY);
    expect(evtOrderConcurrency({ QUEUE_EVT_ORDER_CONCURRENCY: "8" })).toBe(8);
    expect(evtOrderConcurrency({ QUEUE_EVT_ORDER_CONCURRENCY: "0" })).toBe(DEFAULT_EVT_ORDER_CONCURRENCY);
    expect(evtOrderConcurrency({ QUEUE_EVT_ORDER_CONCURRENCY: "abc" })).toBe(DEFAULT_EVT_ORDER_CONCURRENCY);
  });
});

describe("đẩy tồn (bước 4)", () => {
  it("đọc QUEUE_STOCK_CHANNEL_CONCURRENCY, sai thì về mặc định", () => {
    expect(stockChannelConcurrency({})).toBe(DEFAULT_STOCK_CHANNEL_CONCURRENCY);
    expect(stockChannelConcurrency({ QUEUE_STOCK_CHANNEL_CONCURRENCY: "10" })).toBe(10);
    expect(stockChannelConcurrency({ QUEUE_STOCK_CHANNEL_CONCURRENCY: "0" })).toBe(DEFAULT_STOCK_CHANNEL_CONCURRENCY);
    expect(stockChannelConcurrency({ QUEUE_STOCK_CHANNEL_CONCURRENCY: "x" })).toBe(DEFAULT_STOCK_CHANNEL_CONCURRENCY);
  });

  it("đọc STOCK_SWEEP_SECONDS, sai thì về mặc định", () => {
    expect(stockSweepSeconds({})).toBe(DEFAULT_STOCK_SWEEP_SECONDS);
    expect(stockSweepSeconds({ STOCK_SWEEP_SECONDS: "30" })).toBe(30);
    expect(stockSweepSeconds({ STOCK_SWEEP_SECONDS: "0" })).toBe(DEFAULT_STOCK_SWEEP_SECONDS);
    expect(stockSweepSeconds({ STOCK_SWEEP_SECONDS: "x" })).toBe(DEFAULT_STOCK_SWEEP_SECONDS);
  });
});

describe("tên hàng đợi khớp migration", () => {
  // Ứng dụng chạy migrate:false và không tạo hàng đợi lúc chạy: tên khai trong mã
  // mà migration không tạo thì startQueue hỏng trên prod. Chặn ngay ở test.
  const migrationsDir = path.join(__dirname, "../../../prisma/migrations");
  const sql = fs
    .readdirSync(migrationsDir)
    .filter((d) => fs.existsSync(path.join(migrationsDir, d, "migration.sql")))
    .map((d) => fs.readFileSync(path.join(migrationsDir, d, "migration.sql"), "utf8"))
    .join("\n");
  const created = [...sql.matchAll(/pgboss\.create_queue\('([^']+)'/g)].map((m) => m[1]);

  it("mọi hàng đợi khai trong mã đều được một migration tạo", () => {
    for (const name of ALL_QUEUES) expect(created, `thiếu create_queue('${name}')`).toContain(name);
  });

  it("số lượt trong câu cảnh báo khớp retryLimit của evt.order trong migration", () => {
    const m = sql.match(/create_queue\('evt\.order', '\{[^}]*"retryLimit":(\d+)/);
    expect(m, "không thấy retryLimit của evt.order").not.toBeNull();
    expect(EVT_ORDER_MAX_ATTEMPTS).toBe(Number(m![1]) + 1);
  });

  it("hàng đợi lỗi mà migration trỏ tới đều được khai là hàng đợi lỗi trong mã", () => {
    const deadTargets = new Set([...sql.matchAll(/"deadLetter":"([^"]+)"/g)].map((m) => m[1]));
    expect([...deadTargets].sort()).toEqual([...DEAD_QUEUES].sort());
  });
});

describe("xuất hóa đơn hàng loạt chạy nền (bước 5 lát 9)", () => {
  it("INVOICE_REQUEST_SWEEP_SECONDS: mặc định 5, ngoài khoảng thì về mặc định", () => {
    expect(invoiceRequestSweepSeconds({})).toBe(DEFAULT_INVOICE_REQUEST_SWEEP_SECONDS);
    expect(invoiceRequestSweepSeconds({ INVOICE_REQUEST_SWEEP_SECONDS: "2" })).toBe(2);
    expect(invoiceRequestSweepSeconds({ INVOICE_REQUEST_SWEEP_SECONDS: "0" })).toBe(DEFAULT_INVOICE_REQUEST_SWEEP_SECONDS);
    expect(invoiceRequestSweepSeconds({ INVOICE_REQUEST_SWEEP_SECONDS: "x" })).toBe(DEFAULT_INVOICE_REQUEST_SWEEP_SECONDS);
  });
});

describe("xuất một đơn + điều chỉnh tay qua làn (bước 5 lát 10)", () => {
  it("INVOICE_SINGLE_WAIT_SECONDS: mặc định 25 giây, ngoài khoảng 1–120 thì về mặc định", () => {
    expect(invoiceSingleWaitMs({})).toBe(DEFAULT_INVOICE_SINGLE_WAIT_SECONDS * 1000);
    expect(invoiceSingleWaitMs({ INVOICE_SINGLE_WAIT_SECONDS: "3" })).toBe(3000);
    expect(invoiceSingleWaitMs({ INVOICE_SINGLE_WAIT_SECONDS: "0" })).toBe(DEFAULT_INVOICE_SINGLE_WAIT_SECONDS * 1000);
    expect(invoiceSingleWaitMs({ INVOICE_SINGLE_WAIT_SECONDS: "999" })).toBe(DEFAULT_INVOICE_SINGLE_WAIT_SECONDS * 1000);
  });
});

describe("điều chỉnh tự động thành yêu cầu bền (bước 5 lát 11)", () => {
  it("INVOICE_AUTO_ADJUST_MODE: chỉ nhận queue | legacy, sai thì về mặc định", () => {
    expect(invoiceAutoAdjustMode({})).toBe(DEFAULT_INVOICE_AUTO_ADJUST_MODE);
    expect(invoiceAutoAdjustMode({ INVOICE_AUTO_ADJUST_MODE: " Queue " })).toBe("queue");
    expect(invoiceAutoAdjustMode({ INVOICE_AUTO_ADJUST_MODE: "legacy" })).toBe("legacy");
    expect(invoiceAutoAdjustMode({ INVOICE_AUTO_ADJUST_MODE: "x" })).toBe(DEFAULT_INVOICE_AUTO_ADJUST_MODE);
  });
});
