// ============================================================
// HÀNG RÀO: worker KHÔNG giữ trạng thái nghiệp vụ ở biến cấp module
// (lát 3.6 giai đoạn 3, 15/10/2026 — docs/KIEN-TRUC-QUY-MO-TRIEU-DON.md mục 6.10,
// khẩu vị "cấm mutex RAM" của anh Trung).
//
// Vì sao: trạng thái về gian / đơn / lượt quét nằm trong RAM của MỘT tiến trình
// thì worker thứ hai không thấy, khởi động lại là mất, và không đo được trên HQ.
// Mọi thứ như thế phải nằm ở DB (cột trên Channel, bảng vé, pg-boss). Biến cấp
// module chỉ được là cờ chống chạy chồng trong CÙNG tiến trình (started /
// running…), cấu hình đọc từ env, hoặc tay cầm timer.
//
// Test đọc thẳng mã nguồn thư mục workers/: khai báo `let` ở cấp module phải nằm
// trong danh sách cho phép dưới đây; `new Map` / `new Set` / mảng ở cấp module
// (chỗ chứa trạng thái theo khóa) chỉ được khi là HÀNG CHỜ TRONG TIẾN TRÌNH mà
// sự thật vẫn ở DB (khóa / thuê làn / dòng việc) — cũng phải nằm trong danh sách
// kèm lý do. Thêm tên mới = phải sửa test này, tức là phải nói rõ vì sao nó
// không phải trạng thái nghiệp vụ.
// ============================================================

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const WORKERS_DIR = join(__dirname, "..");

/** Tên biến `let` cấp module được phép, kèm lý do. */
const ALLOWED_LET: Record<string, string> = {
  started: "cờ đã bật worker trong tiến trình này",
  running: "cờ chống chạy chồng một lượt trong tiến trình",
  stopping: "cờ đang tắt (SIGTERM)",
  draining: "cờ chống chạy chồng lượt dựng sổ",
  maintaining: "cờ chống chạy chồng lượt bảo trì sổ",
  sweeping: "cờ chống chạy chồng lượt quét hàng đợi tồn",
  workerId: "định danh tiến trình để thuê làn (hostname:pid:random)",
  sweepTimer: "tay cầm timer",
  requestSweepTimer: "tay cầm timer",
  cadence: "cấu hình nhịp đọc từ env lúc bật",
  adsIntervalHours: "cấu hình nhịp đọc từ env lúc bật",
  concurrency: "cấu hình số gian song song đọc từ env lúc bật",
  lastNightlyKey: "khóa ngày của lượt đêm gần nhất — chống chạy hai lần trong cùng tiến trình, mất khi khởi động lại là vô hại",
  consecutiveErrors: "đếm lỗi liên tiếp để giãn nhịp trong tiến trình",
  lastSignRemindAt: "mốc nhắc ký gần nhất — chỉ chống nhắc dồn trong tiến trình",
  lastCleanupAt: "mốc dọn gần nhất — chỉ chống dọn dồn trong tiến trình",
  tiktokDailyRunsInFlight: "đếm lượt đang chạy để giới hạn song song trong tiến trình",
};

/**
 * Chỗ chứa theo khóa (Map/Set) cấp module được phép — "tệp:tên" kèm lý do. Điều
 * kiện chung: mất khi tiến trình chết KHÔNG mất việc, vì DB mới là sự thật.
 */
const ALLOWED_CONTAINERS: Record<string, string> = {
  "order-auto-sync.ts:inFlight": "gian đang xử lý trong tiến trình này — khóa thật là Channel.syncLockedAt (worker khác nhặt lại sau 15')",
  "order-auto-sync.ts:adsSkipLogged": "chống lặp một dòng log, không phải trạng thái nghiệp vụ",
  "invoice-lanes.ts:running": "promise lượt đang chạy theo gian — thuê làn thật ở bảng invoice_lanes (hết hạn là tiến trình khác nhận)",
  "stock-queue.ts:waiting": "hàng chờ tới lượt trong tiến trình — dòng việc vẫn ở bảng, lưới quét gọi lại",
  "stock-queue.ts:running": "promise lượt đang chạy theo gian — dòng việc vẫn ở bảng",
  "stock-queue.ts:again": "cờ 'gọi lại trong lúc đang chạy' — dòng việc vẫn ở bảng",
};

const LET_RE = /^(let|var)\s+([A-Za-z_$][\w$]*)/;
const CONTAINER_RE = /^const\s+([A-Za-z_$][\w$]*)(\s*:\s*[^=]+)?\s*=\s*(new\s+(Map|Set|WeakMap)\b|\[\s*\]|\{\s*\})/;

function moduleLevelLines(src: string): { line: number; text: string }[] {
  // Cấp module = dòng bắt đầu ở cột 0 (không thụt đầu dòng), bỏ chú thích.
  return src
    .split("\n")
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => /^(let|var|const)\s/.test(text));
}

describe("workers/ không giữ trạng thái nghiệp vụ ở biến cấp module", () => {
  const files = readdirSync(WORKERS_DIR).filter((f) => f.endsWith(".ts"));

  it("có tệp worker để kiểm", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(`${file}: let / Map / Set cấp module chỉ trong danh sách cho phép`, () => {
      const src = readFileSync(join(WORKERS_DIR, file), "utf8");
      const offenders: string[] = [];
      for (const { line, text } of moduleLevelLines(src)) {
        const m = LET_RE.exec(text);
        if (m) {
          if (!(m[2] in ALLOWED_LET)) offenders.push(`${file}:${line} let ${m[2]} — thêm vào ALLOWED_LET kèm lý do, hoặc chuyển xuống DB`);
          continue;
        }
        const c = CONTAINER_RE.exec(text);
        if (c && !(`${file}:${c[1]}` in ALLOWED_CONTAINERS)) {
          offenders.push(
            `${file}:${line} const ${c[1]} — chỗ chứa trạng thái theo khóa ở RAM: chuyển xuống DB, hoặc thêm vào ALLOWED_CONTAINERS kèm lý do vì sao mất là không mất việc`
          );
        }
      }
      expect(offenders, offenders.join("\n")).toEqual([]);
    });
  }

  it("danh sách cho phép không có mục thừa (tên không còn trong mã)", () => {
    const all = files.map((f) => ({ f, src: readFileSync(join(WORKERS_DIR, f), "utf8") }));
    for (const key of Object.keys(ALLOWED_CONTAINERS)) {
      const [f, name] = key.split(":");
      const src = all.find((x) => x.f === f)?.src ?? "";
      expect(new RegExp(`^const\\s+${name}\\b`, "m").test(src), `${key} không còn trong mã — xóa khỏi ALLOWED_CONTAINERS`).toBe(true);
    }
  });
});
