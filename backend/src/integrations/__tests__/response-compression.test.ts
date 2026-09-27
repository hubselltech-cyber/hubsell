// Nén phản hồi HTTP (egress Render 09/2026): JSON đủ lớn phải gzip khi client
// chấp nhận; luồng SSE (text/event-stream) KHÔNG được nén vì nén sẽ đệm sự kiện.
import "./load-env";
import express from "express";
import http, { type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { responseCompression } from "../../app";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(responseCompression());
  app.get("/big", (_req, res) => {
    res.json({ rows: Array.from({ length: 200 }, (_, i) => ({ i, name: `dong-${i}` })) });
  });
  app.get("/sse", (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write(": connected\n\n");
    res.end();
  });
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

// fetch (undici) tự giải nén và giấu Content-Encoding → dùng http.request thô.
function rawGet(path: string): Promise<{ headers: http.IncomingHttpHeaders; bytes: number }> {
  return new Promise((resolve, reject) => {
    const u = new URL(`${baseUrl}${path}`);
    const req = http.request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "GET",
        headers: { "Accept-Encoding": "gzip" },
      },
      (res) => {
        let bytes = 0;
        res.on("data", (c: Buffer) => (bytes += c.length));
        res.on("end", () => resolve({ headers: res.headers, bytes }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("response compression", () => {
  it("gzip JSON lớn khi client chấp nhận gzip", async () => {
    const r = await rawGet("/big");
    expect(r.headers["content-encoding"]).toBe("gzip");
    expect(r.headers["vary"]).toContain("Accept-Encoding");
    expect(r.bytes).toBeLessThan(2000); // bản thô ~5 KB
  });

  it("KHÔNG nén luồng SSE text/event-stream", async () => {
    const r = await rawGet("/sse");
    expect(r.headers["content-type"]).toBe("text/event-stream");
    expect(r.headers["content-encoding"]).toBeUndefined();
  });
});
