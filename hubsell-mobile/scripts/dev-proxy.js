/**
 * PROXY DEV CHỈ CHO GIẢ LẬP WEB (expo start --web).
 *
 * Backend production dùng CORS allowlist cố ý hẹp (hubsell.tech + localhost:3000)
 * nên trình duyệt tại localhost:8081 bị chặn. App NATIVE trên điện thoại không
 * có CORS — gọi thẳng Render, KHÔNG đi qua proxy này. Nhờ vậy backend giữ
 * nguyên 0 thay đổi.
 *
 * Chỉ lắng nghe 127.0.0.1 — không mở ra mạng LAN.
 */
const http = require("http");
const https = require("https");

const TARGET = process.env.HUBSELL_API ?? "https://hubsell-backend-sg.onrender.com";
const PORT = 8099;

http
  .createServer((req, res) => {
    const cors = {
      "Access-Control-Allow-Origin": req.headers.origin ?? "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const url = new URL(req.url, TARGET);
    const headers = {};
    if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    const proxyReq = https.request(
      url,
      { method: req.method, headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, {
          ...cors,
          "content-type": proxyRes.headers["content-type"] ?? "application/json",
        });
        proxyRes.pipe(res);
      }
    );
    proxyReq.on("error", (err) => {
      res.writeHead(502, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ error: `Proxy lỗi: ${err.message}` }));
    });
    req.pipe(proxyReq);
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`[dev-proxy] http://localhost:${PORT} → ${TARGET}`);
  });
