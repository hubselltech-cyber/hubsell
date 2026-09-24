/**
 * QUAY MP4 một tour hướng dẫn (để đăng YouTube) — Playwright ghi màn hình trang
 * /guide/render (1920x1080), ffmpeg ghép giọng đọc Hoài My (MP3 thu sẵn).
 *
 * Cách hoạt động:
 *  1. Đo độ dài từng MP3 (ffprobe) → pha zoom mỗi bước nán đủ để đọc hết
 *     (hold = max(2300, dur − 1400) ms; giọng bắt đầu cùng lúc sang bước).
 *  2. Mở /guide/render?tour=X&hold=… trong Chromium headless có recordVideo.
 *     Trang trắng tinh cho tới khi script gọi window.__startTour() (sau khi
 *     nạp sẵn mọi ảnh) → khung hình đầu tiên hết trắng = mốc 0 của tour.
 *  3. Trang ghi performance.now() mỗi lần sang bước (window.__stepTimes) →
 *     mốc đặt từng MP3 lấy theo số đo THẬT, không cộng dồn timeout nên không lệch.
 *  4. ffmpeg: dò mốc 0 bằng độ sáng trung bình khung hình (YAVG), cắt video từ
 *     đó, trộn 15 MP3 theo mốc (adelay + amix), xuất H.264/AAC 1920x1080.
 *
 * Chạy: node scripts/render-tour-video.js [lazada|channels|kho|donhang|hoadon] [thư-mục-ra]
 *   mặc định tour lazada, ra %USERPROFILE%\Downloads\hubsell-huong-dan-<tour>.mp4
 * Cần: frontend dev server localhost:3000, ffmpeg + ffprobe trong PATH.
 */
const { chromium } = require("playwright");
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TOUR = process.argv[2] || "lazada";
const OUT_DIR = process.argv[3] || path.join(os.homedir(), "Downloads");
const PUBLIC = path.resolve(__dirname, "../public");
const VOICE_DIR = {
  lazada: "guide-assets/voice/lazada",
  channels: "onboarding/voice",
  kho: "guide-assets/voice/kho",
  donhang: "guide-assets/voice/donhang",
  hoadon: "guide-assets/voice/hoadon",
}[TOUR];
if (!VOICE_DIR) throw new Error("Tour không hợp lệ: " + TOUR);

const MOVE_MS = 1000;
const CLICK_MS = 700;
const MIN_ZOOM_MS = 2300;
const TAIL_MS = 2500; // nán ở màn kết thúc
const VOICE_GAP_TOL_MS = 150; // hai giọng chồng dưới mức này coi như không đè

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 << 20 });
const durationSec = (file) =>
  Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]));

(async () => {
  // 1) MP3 + độ dài
  const voiceDir = path.join(PUBLIC, VOICE_DIR);
  const mp3s = [];
  for (let i = 1; ; i++) {
    const f = path.join(voiceDir, `step-${i}.mp3`);
    if (!fs.existsSync(f)) break;
    mp3s.push(f);
  }
  if (!mp3s.length) throw new Error("Không thấy MP3 ở " + voiceDir);
  const durs = mp3s.map(durationSec);
  const hold = durs.map((d) => Math.max(MIN_ZOOM_MS, Math.round(d * 1000) - 1400));
  console.log("MP3:", mp3s.length, "file; độ dài(s):", durs.map((d) => d.toFixed(1)).join(", "));

  // 2) Quay
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hubsell-tour-"));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    locale: "vi-VN",
    recordVideo: { dir: tmp, size: { width: 1920, height: 1080 } },
  });
  const page = await ctx.newPage();
  const url = `http://localhost:3000/guide/render?tour=${TOUR}&hold=${hold.join(",")}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Ẩn nút "N" của Next dev (nextjs-portal) kẻo lọt vào góc video đăng YouTube
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForFunction(() => typeof window.__startTour === "function", null, { timeout: 120000 });
  // Nạp sẵn ảnh để không có khung hình trắng giữa chừng
  await page.evaluate(async () => {
    const imgs = window.__tourImages || [];
    await Promise.all(
      imgs.map(
        (src) =>
          new Promise((res) => {
            const im = new Image();
            im.onload = im.onerror = res;
            im.src = src;
          })
      )
    );
    await document.fonts.ready;
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__startTour());
  // Chờ player mount (nhãn "Bước 1/…" xuất hiện) rồi chờ phát hết
  await page.getByText(/Bước 1\//).waitFor({ timeout: 30000 });
  const expectedMs = hold.reduce((s, h) => s + MOVE_MS + CLICK_MS + h + 700, 0) + 15000;
  await page.waitForFunction(() => window.__tourDone === true, null, { timeout: expectedMs + 60000 });
  await page.waitForTimeout(TAIL_MS);
  // Mảng thưa theo chỉ số bước (trang render giữ mốc ĐẦU TIÊN của mỗi bước).
  const stepTimes = await page.evaluate(() => Array.from(window.__stepTimes || [], (t) => t ?? null));
  if (stepTimes.some((t) => t == null)) throw new Error("Thiếu mốc bước: " + JSON.stringify(stepTimes));
  await ctx.close(); // ghi xong video
  await browser.close();
  const webm = fs.readdirSync(tmp).map((f) => path.join(tmp, f)).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("Không thấy file video trong " + tmp);
  if (stepTimes.length !== mp3s.length)
    throw new Error(
      `Số mốc bước (${stepTimes.length}) khác số MP3 (${mp3s.length}) — mốc đo được không đáng tin, ` +
        "dừng để không xuất ra video đè tiếng. Chạy lại với dev server vừa khởi động."
    );

  // 3) Mốc 0: khung hình đầu tiên hết trắng (YAVG < 200). Dùng ffmpeg +
  // metadata=print ra stderr — bộ lọc movie= của ffprobe không ăn đường dẫn
  // Windows (dấu hai chấm + khoảng trắng).
  const probe = spawnSync(
    "ffmpeg",
    ["-v", "info", "-nostats", "-i", webm, "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-an", "-f", "null", "-"],
    { encoding: "utf8", maxBuffer: 256 << 20 }
  );
  let startSec = null;
  let pts = null;
  const lines = String(probe.stderr || "").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/pts_time:([\d.]+)/);
    if (m) pts = Number(m[1]);
    const y = line.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
    if (y && pts != null && Number(y[1]) < 200) {
      startSec = pts;
      break;
    }
  }
  if (startSec == null) throw new Error("Không dò được mốc bắt đầu tour trong video");
  console.log("Mốc bắt đầu trong video:", startSec.toFixed(3), "s");

  // 4) Ghép âm: mỗi MP3 đặt tại mốc bước tương ứng (so với bước 1)
  const offsets = stepTimes.map((t) => Math.max(0, Math.round(t - stepTimes[0])));
  // Mốc đặt giọng (ms) + mốc kết thúc từng câu — soi nhanh khi tiếng lệch/mất câu.
  console.log(
    "Moc dat giong (s):",
    offsets.map((o, i) => `${i + 1}:${(o / 1000).toFixed(1)}->${((o + durs[i] * 1000) / 1000).toFixed(1)}`).join("  ")
  );
  // CHẶN ĐÈ TIẾNG — sự cố 14/09: mốc bước 2 bị ghi trùng mốc bước 1 nên lời
  // bước 2 rơi về giây 0 đọc chồng lên lời bước 1, cả dàn dồn lên một nấc và
  // lời bước cuối rớt ra ngoài video. Mắt không thấy, chỉ nghe mới biết — nên
  // thà dừng hẳn còn hơn xuất ra file hỏng. Dung sai 150ms: đuôi MP3 thường đã
  // là khoảng lặng, chồng dưới mức này không nghe ra.
  const va = [];
  for (let i = 0; i + 1 < offsets.length; i++) {
    const thua = Math.round(offsets[i] + durs[i] * 1000 - offsets[i + 1]);
    if (thua > VOICE_GAP_TOL_MS)
      va.push(
        `  bước ${i + 1} (${(offsets[i] / 1000).toFixed(1)}s, dài ${durs[i].toFixed(1)}s) chồng ` +
          `${(thua / 1000).toFixed(1)}s sang bước ${i + 2} (${(offsets[i + 1] / 1000).toFixed(1)}s)`
      );
  }
  if (va.length)
    throw new Error(
      "Mốc giọng bị đè tiếng, KHÔNG xuất video:\n" +
        va.join("\n") +
        "\nMốc bước đo từ trang render sai. Chạy lại với dev server vừa khởi động " +
        "(mount lại giữa chừng do HMR/StrictMode là nguyên nhân đã gặp)."
    );

  const inputs = [];
  const filters = [];
  mp3s.forEach((f, i) => {
    inputs.push("-i", f);
    filters.push(`[${i + 1}:a]aresample=48000,adelay=${offsets[i]}|${offsets[i]}[a${i}]`);
  });
  filters.push(
    `${mp3s.map((_, i) => `[a${i}]`).join("")}amix=inputs=${mp3s.length}:normalize=0:dropout_transition=0,apad[aout]`
  );
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `hubsell-huong-dan-${TOUR}.mp4`);
  run("ffmpeg", [
    "-y", "-ss", String(startSec), "-i", webm, ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "0:v", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out,
  ]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("XONG:", out, `(${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
