// Luồng phụ đọc lớp chữ của vận đơn — cầu nối ở locate.ts, cảnh báo bộ nhớ ở read-page.ts.
import { parentPort } from "node:worker_threads";
import { readFirstPageInProcess } from "./read-page";

parentPort?.on("message", (msg: { id: number; pdf: Uint8Array }) => {
  readFirstPageInProcess(msg.pdf)
    .then((page) => parentPort?.postMessage({ id: msg.id, page }))
    .catch(() => parentPort?.postMessage({ id: msg.id, page: null }));
});
