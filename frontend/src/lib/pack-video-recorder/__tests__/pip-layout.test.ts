// Chạy (từ thư mục frontend):
//   node --import ../backend/node_modules/tsx/dist/loader.mjs --test "src/lib/pack-video-recorder/__tests__/*.test.ts"
// Ô CẬN CẢNH ghép vào góc video (19/11/2026, mục 22 tài liệu thiết kế): phần tính vị trí / vùng cắt — thuần.
import assert from "node:assert/strict";
import { test } from "node:test";

import { PIP_DEFAULT, PIP_LIMITS, clampPip, movePip, pictureArea, pipRect, pipSourceCrop, resizePip } from "../pip-layout";

const FRAME = { width: 1280, height: 720 };
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

test("mặc định nằm trọn trong khung, ở góc phải dưới", () => {
  const r = pipRect(PIP_DEFAULT, FRAME);
  assert.ok(r.x + r.w <= FRAME.width && r.y + r.h <= FRAME.height);
  assert.ok(r.x > FRAME.width / 2 && r.y > FRAME.height / 2);
  assert.deepEqual(clampPip(PIP_DEFAULT), PIP_DEFAULT);
});

test("dữ liệu lạ từ localStorage (thiếu, NaN, chữ, số quá cỡ) → về vùng hợp lệ, không ném lỗi", () => {
  assert.deepEqual(clampPip(null), PIP_DEFAULT);
  assert.deepEqual(clampPip({}), PIP_DEFAULT);
  const odd = clampPip({ x: Number.NaN, y: "a" as unknown as number, w: 9, h: -1, zoom: 100 });
  assert.equal(odd.w, PIP_LIMITS.maxW);
  assert.equal(odd.h, PIP_LIMITS.minH);
  assert.equal(odd.zoom, PIP_LIMITS.maxZoom);
  assert.ok(odd.x >= 0 && odd.x + odd.w <= 1 && odd.y >= 0 && odd.y + odd.h <= 1);
});

test("kéo ô ra ngoài mép thì dừng ở mép, cỡ không đổi", () => {
  const moved = movePip(PIP_DEFAULT, 5, 5);
  near(moved.x + moved.w, 1);
  near(moved.y + moved.h, 1);
  assert.equal(moved.w, PIP_DEFAULT.w);
  const back = movePip(PIP_DEFAULT, -5, -5);
  assert.equal(back.x, 0);
  assert.equal(back.y, 0);
});

test("kéo một góc: góc đối diện đứng yên, cỡ không vượt giới hạn, không ra ngoài khung", () => {
  const start = { x: 0.4, y: 0.4, w: 0.2, h: 0.3, zoom: 1 };
  const grown = resizePip(start, "nw", -0.1, -0.1);
  near(grown.x + grown.w, 0.6);
  near(grown.y + grown.h, 0.7);
  near(grown.w, 0.3);
  near(grown.h, 0.4);
  const tiny = resizePip(start, "se", -5, -5);
  near(tiny.w, PIP_LIMITS.minW);
  near(tiny.h, PIP_LIMITS.minH);
  assert.equal(tiny.x, start.x);
  assert.equal(tiny.y, start.y);
  const huge = resizePip(start, "se", 5, 5);
  assert.ok(huge.w <= PIP_LIMITS.maxW + 1e-9 && huge.h <= PIP_LIMITS.maxH + 1e-9);
  assert.ok(huge.x + huge.w <= 1 + 1e-9 && huge.y + huge.h <= 1 + 1e-9);
  const corner = resizePip({ ...start, x: 0.05, y: 0.05 }, "nw", -1, -1);
  assert.ok(corner.x >= 0 && corner.y >= 0);
});

test("vùng lấy từ camera cận: đúng tỷ lệ của ô (không méo), nằm giữa, nằm trong hình gốc", () => {
  const source = { width: 1920, height: 1080 };
  const box = pipRect(PIP_DEFAULT, FRAME);
  const crop = pipSourceCrop(PIP_DEFAULT, FRAME, source);
  near(crop.sw / crop.sh, box.w / box.h, 1e-6);
  near(crop.sx + crop.sw / 2, source.width / 2, 1e-6);
  near(crop.sy + crop.sh / 2, source.height / 2, 1e-6);
  assert.ok(crop.sx >= 0 && crop.sy >= 0 && crop.sx + crop.sw <= source.width + 1e-6 && crop.sy + crop.sh <= source.height + 1e-6);
  // Ô gần vuông, camera ngang → lấy trọn chiều cao, cắt hai bên.
  near(crop.sh, source.height, 1e-6);
});

test("phóng to 2 lần → vùng lấy hẹp còn một nửa mỗi chiều, vẫn ở giữa", () => {
  const source = { width: 1920, height: 1080 };
  const base = pipSourceCrop(PIP_DEFAULT, FRAME, source);
  const zoomed = pipSourceCrop({ ...PIP_DEFAULT, zoom: 2 }, FRAME, source);
  near(zoomed.sw, base.sw / 2, 1e-6);
  near(zoomed.sh, base.sh / 2, 1e-6);
  near(zoomed.sx + zoomed.sw / 2, source.width / 2, 1e-6);
});

test("ô dẹt ngang trên camera 4:3 → lấy trọn bề ngang, cắt trên dưới", () => {
  const wide = { x: 0.1, y: 0.1, w: 0.5, h: 0.15, zoom: 1 };
  const source = { width: 640, height: 480 };
  const crop = pipSourceCrop(wide, FRAME, source);
  near(crop.sw, source.width, 1e-6);
  assert.ok(crop.sh < source.height);
});

test("khung xem trước: camera 16:9 phủ kín; camera 4:3 có dải đen hai bên; camera siêu rộng có dải trên dưới", () => {
  assert.deepEqual(pictureArea({ width: 1280, height: 720 }), { left: 0, top: 0, width: 1, height: 1 });
  const narrow = pictureArea({ width: 640, height: 480 });
  near(narrow.width, 0.75, 1e-9);
  near(narrow.left, 0.125, 1e-9);
  assert.equal(narrow.height, 1);
  const ultra = pictureArea({ width: 2560, height: 1080 });
  assert.equal(ultra.width, 1);
  assert.ok(ultra.height < 1 && ultra.top > 0);
  assert.deepEqual(pictureArea(null), { left: 0, top: 0, width: 1, height: 1 });
});
