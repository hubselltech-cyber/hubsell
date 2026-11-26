// Chạy: (từ thư mục frontend)
//   node --import ../backend/node_modules/tsx/dist/loader.mjs --test "src/lib/pack-video-recorder/__tests__/*.test.ts"
// Trình tự gửi một clip (upload-flow.ts): đường bản 1, đường bản 2 "vé không ghi" (M2.4), và các ngã rẽ giữa hai đường.
// Máy chủ + kho là đồ giả ghi lại từng lượt gọi — không mạng, không trình duyệt.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PackVideoUploadPlan } from "@/lib/api";

import { StorageError, runUpload, type UploadApi, type UploadMemo, type UploadRequest } from "../upload-flow";

const PART = 8;
const HOURS = { purchasedSeconds: 7200, usedSeconds: 60, remainingSeconds: 7140 };

/** Lỗi nghiệp vụ của máy chủ — cùng hình với ApiError (status + code). */
function apiError(status: number, code: string): Error {
  return Object.assign(new Error(code), { status, code });
}

function single(tag: string): PackVideoUploadPlan {
  return { mode: "single", url: `https://kho/${tag}`, headers: { "Content-Type": "video/mp4" }, expiresAt: "2026-11-26T10:15:00.000Z" };
}

function multipart(tag: string, partNumbers: number[], uploadedParts?: number[]): PackVideoUploadPlan {
  return {
    mode: "multipart",
    partSize: PART,
    parts: partNumbers.map((n) => ({ partNumber: n, url: `https://kho/${tag}/manh-${n}` })),
    ...(uploadedParts ? { uploadedParts } : {}),
    expiresAt: "2026-11-26T10:15:00.000Z",
  };
}

class Harness {
  calls: string[] = [];
  uploadV2 = true;
  /** Kết quả lần lượt của từng lượt gọi; hết danh sách thì dùng mặc định. Phần tử là Error thì ném. */
  beginV2Script: unknown[] = [];
  completeV2Script: unknown[] = [];
  putScript = new Map<string, unknown[]>();
  v1Plan: PackVideoUploadPlan | null = single("v1");
  heldParts: number[] = [];
  progress: number[] = [];
  blobReads = 0;
  memo: UploadMemo = {};

  private next(script: unknown[], fallback: unknown): unknown {
    const v = script.length ? script.shift() : fallback;
    if (v instanceof Error) throw v;
    return v;
  }

  api: UploadApi = {
    uploadV2Enabled: async () => this.uploadV2,
    begin: async (p) => {
      this.calls.push(`begin ${p.clientId}`);
      return { video: { id: "vid-v1", status: "PENDING" }, upload: this.v1Plan, hours: HOURS };
    },
    signParts: async (id, n) => {
      this.calls.push(`parts ${id} [${n}]`);
      return { parts: n.map((x) => ({ partNumber: x, url: `https://kho/v1-ky-lai/manh-${x}` })) };
    },
    complete: async (id) => {
      this.calls.push(`complete ${id}`);
      return { hours: HOURS };
    },
    beginV2: async (p) => {
      this.calls.push(`v2 ${p.clientId}`);
      return this.next(this.beginV2Script, {
        video: { id: "vid-v2", status: "PENDING" },
        upload: single("v2"),
        ticket: "ve-1",
        hours: HOURS,
      }) as Awaited<ReturnType<UploadApi["beginV2"]>>;
    },
    signPartsV2: async (ticket, n) => {
      this.calls.push(`v2/parts ${ticket} [${n}]`);
      return {
        parts: n.map((x) => ({ partNumber: x, url: `https://kho/v2-ky-lai/manh-${x}` })),
        uploadedParts: this.heldParts,
        expiresAt: "2026-11-26T10:30:00.000Z",
      };
    },
    completeV2: async (ticket) => {
      this.calls.push(`v2/complete ${ticket}`);
      return this.next(this.completeV2Script, { hours: HOURS }) as { hours?: typeof HOURS };
    },
  };

  put = async (url: string, _headers: Record<string, string>, body: Blob, onProgress: (n: number) => void) => {
    this.calls.push(`PUT ${url} (${body.size})`);
    const script = this.putScript.get(url);
    if (script?.length) {
      const v = script.shift();
      if (v instanceof Error) throw v;
    }
    onProgress(body.size);
  };

  req(sizeBytes: number, memo: UploadMemo | undefined = this.memo): UploadRequest {
    return {
      clientId: "clip-0001",
      code: "SPXVN01",
      kind: "PACK",
      startedAtIso: "2026-11-26T09:58:00.000Z",
      durationSec: 61.4,
      sizeBytes,
      width: 768,
      height: 1024,
      deviceName: "Bàn 1",
      blob: async () => {
        this.blobReads++;
        return new Blob([new Uint8Array(sizeBytes)]);
      },
      onProgress: (n) => this.progress.push(n),
      memo,
    };
  }

  run(sizeBytes = 5) {
    return runUpload(this.req(sizeBytes), { api: this.api, put: this.put });
  }
}

test("/session KHÔNG bảo dùng bản 2 → đi đúng đường bản 1 như trước, không gọi /v2 nào", async () => {
  const h = new Harness();
  h.uploadV2 = false;
  assert.deepEqual(await h.run(), HOURS);
  assert.deepEqual(h.calls, ["begin clip-0001", "PUT https://kho/v1 (5)", "complete vid-v1"]);
  assert.equal(h.memo.v2, undefined);
});

test("/session bảo uploadV2 → xin vé ở /v2, PUT lên kho, báo xong ở /v2/complete BẰNG VÉ; xong thì bỏ vé", async () => {
  const h = new Harness();
  assert.deepEqual(await h.run(), HOURS);
  assert.deepEqual(h.calls, ["v2 clip-0001", "PUT https://kho/v2 (5)", "v2/complete ve-1"]);
  assert.equal(h.memo.v2, null);
  assert.deepEqual(h.progress, [5]);
});

test("bản 2 tải theo mảnh: mảnh thiếu đường dẫn / đường dẫn hết hạn (403) → ký lại ở /v2/parts bằng vé", async () => {
  const h = new Harness();
  // Tệp 20 byte, mảnh 8 → 3 mảnh; máy chủ chỉ ký sẵn mảnh 1 + 2.
  h.beginV2Script = [{ video: { id: "vid-v2", status: "PENDING" }, upload: multipart("v2", [1, 2]), ticket: "ve-1", hours: HOURS }];
  h.putScript.set("https://kho/v2/manh-2", [new StorageError(403, "hết hạn")]);
  assert.deepEqual(await h.run(20), HOURS);
  assert.deepEqual(h.calls, [
    "v2 clip-0001",
    "PUT https://kho/v2/manh-1 (8)",
    "PUT https://kho/v2/manh-2 (8)",
    "v2/parts ve-1 [2]",
    "PUT https://kho/v2-ky-lai/manh-2 (8)",
    "v2/parts ve-1 [3]",
    "PUT https://kho/v2-ky-lai/manh-3 (4)",
    "v2/complete ve-1",
  ]);
  assert.equal(h.progress.at(-1), 20);
});

test("409 V2_OFF (máy chủ vừa tắt bản 2) → clip này quay về đường bản 1", async () => {
  const h = new Harness();
  h.beginV2Script = [apiError(409, "V2_OFF")];
  assert.deepEqual(await h.run(), HOURS);
  assert.deepEqual(h.calls, ["v2 clip-0001", "begin clip-0001", "PUT https://kho/v1 (5)", "complete vid-v1"]);
  assert.equal(h.memo.v2, null);
});

test("409 TICKET_INVALID lúc báo xong → bỏ vé, bắt đầu lại NGAY với cùng clientId, dùng vé mới", async () => {
  const h = new Harness();
  h.beginV2Script = [
    { video: { id: "vid-v2", status: "PENDING" }, upload: single("v2"), ticket: "ve-cu", hours: HOURS },
    { video: { id: "vid-v2", status: "PENDING" }, upload: single("v2-moi"), ticket: "ve-moi", hours: HOURS },
  ];
  h.completeV2Script = [apiError(409, "TICKET_INVALID")];
  assert.deepEqual(await h.run(), HOURS);
  assert.deepEqual(h.calls, [
    "v2 clip-0001",
    "PUT https://kho/v2 (5)",
    "v2/complete ve-cu",
    "v2 clip-0001",
    "PUT https://kho/v2-moi (5)",
    "v2/complete ve-moi",
  ]);
  assert.equal(h.memo.v2, null);
});

test("TICKET_INVALID hai lần liền → không lặp vô hạn: ném lỗi cho hàng chờ thử lại sau, vé đã bỏ", async () => {
  const h = new Harness();
  h.completeV2Script = [apiError(409, "TICKET_INVALID"), apiError(409, "TICKET_INVALID")];
  await assert.rejects(h.run(), (err: unknown) => (err as { code?: string }).code === "TICKET_INVALID");
  assert.equal(h.calls.filter((c) => c.startsWith("v2 ")).length, 2);
  assert.equal(h.memo.v2, null);
});

test("thử lại cùng clip, tải theo mảnh: DÙNG LẠI vé — không xin vé mới, hỏi kho rồi chỉ gửi mảnh còn thiếu", async () => {
  const h = new Harness();
  h.beginV2Script = [{ video: { id: "vid-v2", status: "PENDING" }, upload: multipart("v2", [1, 2, 3]), ticket: "ve-1", hours: HOURS }];
  h.putScript.set("https://kho/v2/manh-2", [new StorageError(0, "mất mạng")]);
  await assert.rejects(h.run(20), StorageError);
  assert.deepEqual(h.calls, ["v2 clip-0001", "PUT https://kho/v2/manh-1 (8)", "PUT https://kho/v2/manh-2 (8)"]);
  assert.equal(h.memo.v2?.ticket, "ve-1");

  // Hàng chờ thử lại (cùng `memo` của việc gửi): kho đang giữ mảnh 1.
  h.calls = [];
  h.heldParts = [1];
  assert.deepEqual(await h.run(20), HOURS);
  assert.deepEqual(h.calls, [
    "v2/parts ve-1 [1,2,3]",
    "PUT https://kho/v2-ky-lai/manh-2 (8)",
    "PUT https://kho/v2-ky-lai/manh-3 (4)",
    "v2/complete ve-1",
  ]);
  assert.equal(h.memo.v2, null);
});

test("tệp đã lên kho nhưng bước báo xong hỏng (máy chủ bận) → lần thử lại CHỈ báo xong bằng vé cũ, không gửi lại tệp", async () => {
  const h = new Harness();
  h.completeV2Script = [Object.assign(new Error("bận"), { status: 503, retryAfterMs: 5_000 })];
  await assert.rejects(h.run(), (err: unknown) => (err as { retryAfterMs?: number }).retryAfterMs === 5_000); // Retry-After đi nguyên ra hàng chờ
  h.calls = [];
  h.uploadV2 = false; // máy chủ tắt bản 2 giữa chừng: vé đã cấp vẫn dùng tiếp
  assert.deepEqual(await h.run(), HOURS);
  assert.deepEqual(h.calls, ["v2/complete ve-1"]);
  assert.equal(h.blobReads, 1);
});

test("máy chủ bảo kho chưa có tệp (NOT_UPLOADED) → lần thử lại gửi lại tệp: tải một lượt thì xin vé mới", async () => {
  const h = new Harness();
  h.completeV2Script = [apiError(409, "NOT_UPLOADED")];
  await assert.rejects(h.run());
  h.calls = [];
  h.beginV2Script = [{ video: { id: "vid-v2", status: "PENDING" }, upload: single("v2-lan-2"), ticket: "ve-2", hours: HOURS }];
  assert.deepEqual(await h.run(), HOURS);
  assert.deepEqual(h.calls, ["v2 clip-0001", "PUT https://kho/v2-lan-2 (5)", "v2/complete ve-2"]);
});

test("UPLOAD_EXPIRED khi xin ký lại bằng vé (kho đã hủy lượt tải theo mảnh) → bỏ vé; lần thử sau xin vé mới", async () => {
  const h = new Harness();
  h.memo.v2 = { ticket: "ve-cu", plan: multipart("v2", [1, 2, 3]), sent: false };
  h.api.signPartsV2 = async (ticket, n) => {
    h.calls.push(`v2/parts ${ticket} [${n}]`);
    throw apiError(409, "UPLOAD_EXPIRED");
  };
  await assert.rejects(h.run(20), (err: unknown) => (err as { code?: string }).code === "UPLOAD_EXPIRED");
  assert.deepEqual(h.calls, ["v2/parts ve-cu [1,2,3]"]);
  assert.equal(h.memo.v2, null);
});

test("/v2 trả ticket = null (clip đã có dòng sổ từ bản 1) → đi tiếp đường bản 1 theo id; đã lưu rồi thì chỉ báo xong", async () => {
  const pending = new Harness();
  pending.beginV2Script = [{ video: { id: "vid-cu", status: "PENDING" }, upload: multipart("cu", [1], [1]), ticket: null, hours: HOURS }];
  assert.deepEqual(await pending.run(20), HOURS);
  assert.deepEqual(pending.calls, [
    "v2 clip-0001",
    "parts vid-cu [2]",
    "PUT https://kho/v1-ky-lai/manh-2 (8)",
    "parts vid-cu [3]",
    "PUT https://kho/v1-ky-lai/manh-3 (4)",
    "complete vid-cu",
  ]);
  assert.equal(pending.memo.v2 ?? null, null);

  const stored = new Harness();
  stored.beginV2Script = [{ video: { id: "vid-cu", status: "STORED" }, upload: null, ticket: null, hours: HOURS }];
  assert.deepEqual(await stored.run(), HOURS);
  assert.deepEqual(stored.calls, ["v2 clip-0001", "complete vid-cu"]);
  assert.equal(stored.blobReads, 0);
});
