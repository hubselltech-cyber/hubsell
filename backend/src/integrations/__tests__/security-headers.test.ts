// Header bảo mật HTTP của backend (hồ sơ ISV Shopee yêu cầu URL live có xếp
// hạng bảo mật "A"). Kiểm: 3 header cố định luôn có, X-Powered-By bị tắt, và
// HSTS chỉ phát khi host KHÔNG phải localhost (phát cho localhost sẽ ép cả
// frontend dev http://localhost:3000 lên https).
import "./load-env";
import http, { type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, isLocalHost } from "../../app";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Không lấy được cổng test");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("security headers", () => {
  it("phát 3 header cố định và tắt X-Powered-By trên route công khai", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  // fetch (undici) không cho ghi đè header Host → dùng http.request thô.
  function getWithHost(host: string): Promise<http.IncomingHttpHeaders> {
    return new Promise((resolve, reject) => {
      const u = new URL(`${baseUrl}/health`);
      const req = http.request(
        { host: u.hostname, port: u.port, path: u.pathname, method: "GET", headers: { Host: host } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.headers));
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("KHÔNG phát HSTS khi host là localhost", async () => {
    const headers = await getWithHost("localhost:4000");
    expect(headers["strict-transport-security"]).toBeUndefined();
  });

  it("phát HSTS khi host là domain thật", async () => {
    const headers = await getWithHost("hubsell-backend-sg.onrender.com");
    expect(headers["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains");
  });

  it("isLocalHost nhận diện đủ các host dev", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("127.0.0.1")).toBe(true);
    expect(isLocalHost("app.localhost")).toBe(true);
    expect(isLocalHost("hubsell-backend-sg.onrender.com")).toBe(false);
    expect(isLocalHost(undefined)).toBe(true);
  });
});
