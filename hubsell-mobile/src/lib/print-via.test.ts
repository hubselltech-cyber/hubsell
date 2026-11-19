/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { primaryPrintVia, secondaryPrintVia } from "./print-via";

const BOTH = { print: true, share: true };

test("lần đầu (chưa lưu gì): nút chính là mở bằng app máy in", () => {
  assert.equal(primaryPrintVia(BOTH, null), "share");
  assert.equal(primaryPrintVia(BOTH, undefined), "share");
  assert.equal(secondaryPrintVia(BOTH, "share"), "print");
});

test("lần trước in qua hộp in của máy thì lối đó lên làm nút chính", () => {
  assert.equal(primaryPrintVia(BOTH, "print"), "print");
  assert.equal(secondaryPrintVia(BOTH, "print"), "share");
});

test("bản lưu hỏng hoặc giá trị lạ thì về mặc định", () => {
  assert.equal(primaryPrintVia(BOTH, ""), "share");
  assert.equal(primaryPrintVia(BOTH, "bluetooth"), "share");
  assert.equal(primaryPrintVia(BOTH, '{"via":"print"}'), "share");
});

test("máy chỉ đi được một lối: lối đó là nút chính, không có nút phụ, bỏ qua bản lưu", () => {
  assert.equal(primaryPrintVia({ print: true, share: false }, "share"), "print");
  assert.equal(secondaryPrintVia({ print: true, share: false }, "print"), null);
  assert.equal(primaryPrintVia({ print: false, share: true }, "print"), "share");
  assert.equal(secondaryPrintVia({ print: false, share: true }, "share"), null);
});

test("bản app không in được lối nào: không có nút nào", () => {
  const none = { print: false, share: false };
  assert.equal(primaryPrintVia(none, "print"), null);
  assert.equal(secondaryPrintVia(none, null), null);
});
