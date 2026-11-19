// Chạy (từ thư mục frontend):
//   node --import ../backend/node_modules/tsx/dist/loader.mjs --test "src/lib/pack-video-recorder/__tests__/*.test.ts"
// HAI DÒNG MÃ HIỆN TRỄ 1 GIÂY (anh Trung 20/11/2026, tài liệu thiết kế mục 25): chạy ĐƯỜNG QUAY THẬT (ClipPipeline)
// với bộ mã hóa + camera giả, ghi lại chữ được in lên TỪNG khung hình rồi soi mốc 1 giây ở clip đầu và sau một lần cắt.
import assert from "node:assert/strict";
import { test } from "node:test";

import { ClipPipeline } from "../clip-pipeline";
import type { StampCanvas } from "../stamp-canvas";

type Tick = (nowMs: number, meta: unknown) => void;

/** Bộ mã hóa giả: nhận khung, không trả gói nào (bài này chỉ soi chữ in lên khung hình). */
class FakeEncoder {
  static isConfigSupported = async () => ({ supported: true });
  state = "configured";
  encodeQueueSize = 0;
  configure(): void {}
  encode(): void {}
  async flush(): Promise<void> {}
  close(): void {
    this.state = "closed";
  }
}
class FakeFrame {
  close(): void {}
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("giây đầu của mỗi clip chỉ có ngày giờ; từ đủ 1 giây mới in mã — kể cả ngay sau một lần cắt", async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { VideoEncoder: g.VideoEncoder, VideoFrame: g.VideoFrame };
  g.VideoEncoder = FakeEncoder;
  g.VideoFrame = FakeFrame;
  try {
    let tick: Tick | null = null;
    const video = {
      requestVideoFrameCallback(cb: Tick) {
        tick = cb;
        return 1;
      },
      cancelVideoFrameCallback() {},
    };
    /** Mỗi khung được vẽ: mốc giờ camera (mili giây) + các dòng mã in lên khung đó. */
    const drawn: { atMs: number; lines: string[] }[] = [];
    let nowMs = 0;
    const stamp = {
      canvas: {},
      resize() {},
      draw(_source: unknown, _now: unknown, lines: readonly string[] = []) {
        drawn.push({ atMs: nowMs, lines: [...lines] });
      },
    };
    const pipeline = new ClipPipeline({
      track: {} as MediaStreamTrack,
      video: video as unknown as HTMLVideoElement,
      width: 1280,
      height: 720,
      fps: 10,
      bitrate: 800_000,
      pumpMode: "rvfc",
      stamp: stamp as unknown as StampCanvas,
      tap: null,
      log: () => {},
      openSink: async () => {
        throw new Error("bài này không ghi tệp");
      },
      discardFile: async () => {},
    });
    await pipeline.open();
    const feed = async (toMs: number) => {
      // 10 khung / giây: mỗi khung cách nhau 100 mili giây.
      for (; nowMs <= toMs; nowMs += 100) {
        assert.ok(tick, "bộ bơm khung phải đã đăng ký");
        tick(nowMs, {});
        await settle();
      }
    };

    // Lúc nghỉ (chưa có clip): không vẽ khung nào.
    await feed(400);
    assert.equal(drawn.length, 0);

    // Tem A được nhận → khung kế tiếp (mốc 500) là khung đầu của clip A.
    pipeline.beginClip("862770000001", false);
    await feed(2400);
    const a = drawn.filter((d) => d.atMs >= 500 && d.atMs <= 2400);
    assert.equal(a[0].atMs, 500);
    for (const d of a) {
      const want = d.atMs - 500 >= 1000 ? ["Mã vận đơn: 862770000001"] : [];
      assert.deepEqual(d.lines, want, `clip A, khung ở ${d.atMs - 500} mili giây`);
    }

    // Máy chủ khớp ra đơn giữa chừng → dòng "Mã đơn hàng" có từ khung kế tiếp.
    pipeline.setOrderCode("862770000001", "261120ABCDEF12");
    await feed(2600);
    assert.deepEqual(drawn.at(-1)?.lines, ["Mã vận đơn: 862770000001", "Mã đơn hàng: 261120ABCDEF12"]);

    // Tem B cắt ngang (khung đầu của clip B ở mốc 2700). Mã đơn hàng của B về NGAY trong giây đầu → vẫn chưa in gì.
    pipeline.beginClip("862770000002", false);
    pipeline.setOrderCode("862770000002", "261120ZZZZZZ99");
    await feed(4500);
    const b = drawn.filter((d) => d.atMs >= 2700);
    assert.equal(b[0].atMs, 2700);
    for (const d of b) {
      const want = d.atMs - 2700 >= 1000 ? ["Mã vận đơn: 862770000002", "Mã đơn hàng: 261120ZZZZZZ99"] : [];
      assert.deepEqual(d.lines, want, `clip B, khung ở ${d.atMs - 2700} mili giây`);
    }
    // Không khung nào của clip B mang mã của tem A.
    assert.ok(b.every((d) => d.lines.every((line) => !line.includes("862770000001"))));
    // KHÔNG gọi pipeline.close(): bộ mã hóa giả không trả gói nào nên clip A không bao giờ "ghép xong" → close() chờ mãi.
  } finally {
    g.VideoEncoder = saved.VideoEncoder;
    g.VideoFrame = saved.VideoFrame;
  }
});
