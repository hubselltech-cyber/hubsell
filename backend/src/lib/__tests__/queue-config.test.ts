import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_QUEUES,
  DEAD_QUEUES,
  DEFAULT_WORKER_POOL_MAX,
  queueOptionsForRole,
  resolveQueueConnection,
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
    });
  });

  it("worker và all giám sát + nhận việc; QUEUE_POOL_MAX sai thì về mặc định", () => {
    expect(queueOptionsForRole("worker", {})).toEqual({
      max: DEFAULT_WORKER_POOL_MAX,
      supervise: true,
      consumes: true,
    });
    expect(queueOptionsForRole("all", { QUEUE_POOL_MAX: "4" }).max).toBe(4);
    expect(queueOptionsForRole("worker", { QUEUE_POOL_MAX: "0" }).max).toBe(DEFAULT_WORKER_POOL_MAX);
    expect(queueOptionsForRole("worker", { QUEUE_POOL_MAX: "abc" }).max).toBe(DEFAULT_WORKER_POOL_MAX);
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

  it("hàng đợi lỗi mà migration trỏ tới đều được khai là hàng đợi lỗi trong mã", () => {
    const deadTargets = new Set([...sql.matchAll(/"deadLetter":"([^"]+)"/g)].map((m) => m[1]));
    expect([...deadTargets].sort()).toEqual([...DEAD_QUEUES].sort());
  });
});
