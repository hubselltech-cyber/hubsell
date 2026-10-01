import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl, withPoolParams } from "../db-url";

const BASE =
  "postgresql://postgres.abc:p%2Fw%2Ass@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require";

describe("withPoolParams", () => {
  it("ghép connection_limit + pool_timeout mặc định, giữ nguyên mật khẩu đã mã hóa URL", () => {
    const out = withPoolParams(BASE)!;
    expect(out).toContain("connection_limit=5");
    expect(out).toContain("pool_timeout=30");
    expect(out).toContain("sslmode=require");
    expect(out).toContain("p%2Fw%2Ass@"); // %2F, %2A không bị giải mã
  });

  it("KHÔNG ghi đè tham số đã đặt tay", () => {
    const out = withPoolParams(`${BASE}&connection_limit=12&pool_timeout=7`)!;
    expect(out).toContain("connection_limit=12");
    expect(out).toContain("pool_timeout=7");
    expect(out.match(/connection_limit=/g)?.length).toBe(1);
  });

  it("chuỗi không có query vẫn ghép được", () => {
    const out = withPoolParams("postgres://u:p@localhost:5432/hubsell")!;
    expect(out).toBe("postgres://u:p@localhost:5432/hubsell?connection_limit=5&pool_timeout=30");
  });

  it("bỏ qua chuỗi không phải postgres / rỗng", () => {
    expect(withPoolParams(undefined)).toBeUndefined();
    expect(withPoolParams("file:./dev.db")).toBe("file:./dev.db");
    expect(withPoolParams("not a url")).toBe("not a url");
  });

  it("resolveDatabaseUrl đọc DB_CONNECTION_LIMIT / DB_POOL_TIMEOUT, sai thì về mặc định", () => {
    expect(
      resolveDatabaseUrl({ DATABASE_URL: BASE, DB_CONNECTION_LIMIT: "8", DB_POOL_TIMEOUT: "45" })
    ).toContain("connection_limit=8&pool_timeout=45");
    expect(resolveDatabaseUrl({ DATABASE_URL: BASE, DB_CONNECTION_LIMIT: "abc" })).toContain(
      "connection_limit=5"
    );
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });

  it("DB_STATEMENT_CACHE_SIZE: không đặt → không ghép; đặt số ≥ 0 (kể cả 0) → ghép; sai → bỏ qua", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: BASE })).not.toContain("statement_cache_size");
    expect(resolveDatabaseUrl({ DATABASE_URL: BASE, DB_STATEMENT_CACHE_SIZE: "20" })).toContain(
      "statement_cache_size=20"
    );
    expect(resolveDatabaseUrl({ DATABASE_URL: BASE, DB_STATEMENT_CACHE_SIZE: "0" })).toContain(
      "statement_cache_size=0"
    );
    for (const bad of ["", " ", "abc", "-1", "2.5"]) {
      expect(resolveDatabaseUrl({ DATABASE_URL: BASE, DB_STATEMENT_CACHE_SIZE: bad })).not.toContain(
        "statement_cache_size"
      );
    }
    // Đặt tay trong chuỗi thắng env
    expect(
      resolveDatabaseUrl({ DATABASE_URL: `${BASE}&statement_cache_size=7`, DB_STATEMENT_CACHE_SIZE: "20" })
    ).toContain("statement_cache_size=7");
  });
});
