// ============================================================
// KIỂM TRƯỚC KHI LẬP HÓA ĐƠN ĐIỀU CHỈNH — hóa đơn bước 5, lát 3 (02/10/2026).
//
// Phần A (không database): hai hàm quyết định ở adjust-precheck.ts với adapter giả.
// Phần B (database dev): luồng issueAdjustmentForOrder trọn vẹn — chặn không ghi
//   sổ, nối lại tờ đã lập ở lượt trước, lượt hỏng dùng lại mã tham chiếu.
// KHÔNG chạm nhà cung cấp thật.
// ============================================================
import "./load-env";
import { InvoiceLogStatus } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { providerHolder } = vi.hoisted(() => ({ providerHolder: { current: null as unknown } }));

vi.mock("../invoice/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../invoice/index")>();
  return { ...actual, getInvoiceProvider: async () => providerHolder.current };
});

import { prisma } from "../../lib/prisma";
import { issueAdjustmentForOrder } from "../invoice/adjust-order";
import {
  planAdjustmentReference,
  sameInvoiceNo,
  verifyOriginalAtProvider,
  type PriorAdjustmentAttempt,
} from "../invoice/adjust-precheck";
import { issueInvoiceForOrder } from "../invoice/issue-order";
import { MISA_CAPABILITIES } from "../invoice/misa-provider";
import type {
  CreateInvoiceInput,
  InvoiceProvider,
  InvoiceResult,
  ProviderCapabilities,
  ReferenceLookup,
} from "../invoice/types";
import { createStockFixture, type StockFixture } from "./fixtures";

const NOT_FOUND: ReferenceLookup = { state: "NOT_FOUND" };
const found = (over: Partial<Extract<ReferenceLookup, { state: "FOUND" }>> = {}): ReferenceLookup => ({
  state: "FOUND",
  invoiceNo: "00000131",
  transactionId: "TX-GOC",
  issued: true,
  deleted: false,
  matches: 1,
  ...over,
});

/** Adapter giả: `atProvider` là "những gì nhà cung cấp đang có", tra theo mã tham chiếu. */
function fakeProvider(opts: {
  capabilities?: Partial<ProviderCapabilities>;
  atProvider?: Record<string, ReferenceLookup>;
  noLookup?: boolean;
  create?: (input: CreateInvoiceInput) => InvoiceResult;
}) {
  const lookups: string[] = [];
  const creates: CreateInvoiceInput[] = [];
  const provider: InvoiceProvider = {
    name: "MISA",
    capabilities: { ...MISA_CAPABILITIES, ...opts.capabilities },
    async createInvoice(input) {
      creates.push(input);
      return (opts.create ?? (() => ({ status: InvoiceLogStatus.FAILED, errorMessage: "chưa cấu hình" })))(input);
    },
    async cancelInvoice() {
      return { status: InvoiceLogStatus.FAILED };
    },
    async checkStatus() {
      return { status: InvoiceLogStatus.FAILED };
    },
    ...(opts.noLookup
      ? {}
      : {
          async findByReference(reference: string) {
            lookups.push(reference);
            return opts.atProvider?.[reference] ?? NOT_FOUND;
          },
        }),
  };
  return { provider, lookups, creates };
}

const ORIGINAL = { invoiceNo: "00000131", orderCode: "DH1", providerRef: "DH1" };
const attempt = (id: string, status: InvoiceLogStatus, providerRef: string | null): PriorAdjustmentAttempt => ({
  id,
  status,
  providerRef,
});

describe("A1. Hóa đơn gốc còn hiệu lực bên nhà cung cấp?", () => {
  it("còn hiệu lực, đúng số → cho qua (số 0 đứng đầu không tính là lệch)", async () => {
    const { provider, lookups } = fakeProvider({ atProvider: { DH1: found({ invoiceNo: "131" }) } });
    expect(await verifyOriginalAtProvider(provider, ORIGINAL)).toBeNull();
    expect(lookups).toEqual(["DH1"]);
    expect(sameInvoiceNo("00000131", "131")).toBe(true);
    expect(sameInvoiceNo("00000131", "00000132")).toBe(false);
  });

  it("dòng đời cũ chưa có mã tham chiếu → tra theo mã đơn", async () => {
    const { provider, lookups } = fakeProvider({ atProvider: { DH1: found() } });
    expect(await verifyOriginalAtProvider(provider, { ...ORIGINAL, providerRef: null })).toBeNull();
    expect(lookups).toEqual(["DH1"]);
  });

  it("đã bị xóa bên nhà cung cấp → CHẶN, có lý do và việc nên làm", async () => {
    const { provider } = fakeProvider({ atProvider: { DH1: found({ deleted: true }) } });
    const block = await verifyOriginalAtProvider(provider, ORIGINAL);
    expect(block).toMatchObject({ code: "HUBSELL_ADJUST_ORIGINAL_DELETED", scope: "ORDER", httpStatus: 409 });
    expect(block!.reason).toContain("00000131");
    expect(block!.reason).toContain("MISA meInvoice");
    expect(block!.suggestion.length).toBeGreaterThan(20);
  });

  it("không tìm thấy → CHẶN; số hóa đơn lệch → CHẶN; chưa phát hành xong → CHẶN", async () => {
    expect(await verifyOriginalAtProvider(fakeProvider({}).provider, ORIGINAL)).toMatchObject({
      code: "HUBSELL_ADJUST_ORIGINAL_NOT_FOUND",
      scope: "ORDER",
    });
    expect(
      await verifyOriginalAtProvider(fakeProvider({ atProvider: { DH1: found({ invoiceNo: "00000999" }) } }).provider, ORIGINAL)
    ).toMatchObject({ code: "HUBSELL_ADJUST_ORIGINAL_MISMATCH", scope: "ORDER" });
    expect(
      await verifyOriginalAtProvider(fakeProvider({ atProvider: { DH1: found({ issued: false }) } }).provider, ORIGINAL)
    ).toMatchObject({ code: "HUBSELL_ADJUST_ORIGINAL_NOT_ISSUED" });
  });

  it("không tra được (nhà cung cấp lỗi) → CHẶN loại tạm thời, nói rõ chưa lập gì", async () => {
    const { provider } = fakeProvider({ atProvider: { DH1: { state: "LOOKUP_FAILED", message: "mạng", accountProblem: false } } });
    const block = await verifyOriginalAtProvider(provider, ORIGINAL);
    expect(block).toMatchObject({ code: "HUBSELL_ADJUST_ORIGINAL_UNCHECKED", scope: "TRANSIENT", httpStatus: 502 });
    expect(block!.suggestion).toContain("Chưa có hóa đơn điều chỉnh nào được lập");
  });

  it("không tra được vì tài khoản nhà cung cấp của shop sai → CHẶN, chỉ chỗ sửa kết nối (thử lại không tự hết)", async () => {
    const { provider } = fakeProvider({
      atProvider: { DH1: { state: "LOOKUP_FAILED", message: "Sai email/SĐT hoặc mật khẩu meInvoice.", accountProblem: true } },
    });
    const block = await verifyOriginalAtProvider(provider, ORIGINAL);
    expect(block).toMatchObject({ code: "HUBSELL_ADJUST_ORIGINAL_UNCHECKED", scope: "ORDER", httpStatus: 409 });
    expect(block!.reason).toContain("Sai email/SĐT hoặc mật khẩu meInvoice.");
    expect(block!.suggestion).toContain("Cấu hình kết nối");
  });

  it("nhà cung cấp tự kiểm hóa đơn gốc, hoặc không có cách tra → không tra, giữ hành vi cũ", async () => {
    const selfChecking = fakeProvider({ capabilities: { validatesAdjustmentOriginal: true } });
    expect(await verifyOriginalAtProvider(selfChecking.provider, ORIGINAL)).toBeNull();
    expect(selfChecking.lookups).toEqual([]);
    const noLookup = fakeProvider({ noLookup: true });
    expect(await verifyOriginalAtProvider(noLookup.provider, ORIGINAL)).toBeNull();
    const declaredOff = fakeProvider({ capabilities: { findByReference: { supported: false } } });
    expect(await verifyOriginalAtProvider(declaredOff.provider, ORIGINAL)).toBeNull();
    expect(declaredOff.lookups).toEqual([]);
  });
});

describe("A2. Mã tham chiếu của lượt điều chỉnh", () => {
  it("chưa có lượt nào → <mã đơn>-DC1, không cần tra", async () => {
    const { provider, lookups } = fakeProvider({});
    expect(await planAdjustmentReference(provider, "DH1", [])).toEqual({ kind: "USE", refId: "DH1-DC1" });
    expect(lookups).toEqual([]);
  });

  it("lượt trước HỎNG và nhà cung cấp không có tờ nào với mã đó → dùng LẠI mã cũ", async () => {
    const { provider, lookups } = fakeProvider({});
    const plan = await planAdjustmentReference(provider, "DH1", [attempt("a", InvoiceLogStatus.FAILED, "DH1-DC1")]);
    expect(plan).toEqual({ kind: "USE", refId: "DH1-DC1" });
    expect(lookups).toEqual(["DH1-DC1"]);
  });

  it("dữ liệu đời cũ DC1 hỏng, DC2 hỏng → tra CẢ HAI, dùng lại mã của lượt gần nhất", async () => {
    const { provider, lookups } = fakeProvider({});
    const plan = await planAdjustmentReference(provider, "DH1", [
      attempt("a", InvoiceLogStatus.FAILED, "DH1-DC1"),
      attempt("b", InvoiceLogStatus.FAILED, "DH1-DC2"),
    ]);
    expect(plan).toEqual({ kind: "USE", refId: "DH1-DC2" });
    expect(lookups).toEqual(["DH1-DC1", "DH1-DC2"]);
  });

  it("một lượt ghi HỎNG nhưng nhà cung cấp ĐÃ LẬP → NỐI LẠI đúng dòng của lượt đó, không lập thêm", async () => {
    const { provider } = fakeProvider({
      atProvider: { "DH1-DC1": found({ invoiceNo: "00000140", transactionId: "TX-DC" }) },
    });
    const plan = await planAdjustmentReference(provider, "DH1", [
      attempt("a", InvoiceLogStatus.FAILED, "DH1-DC1"),
      attempt("b", InvoiceLogStatus.FAILED, "DH1-DC1"), // lượt gửi lại cùng mã — lượt sau cùng mang mã này
      attempt("c", InvoiceLogStatus.FAILED, "DH1-DC2"),
    ]);
    expect(plan).toEqual({ kind: "RECOVER", logId: "b", refId: "DH1-DC1", invoiceNo: "00000140", transactionId: "TX-DC" });
  });

  it("không tra lại được lượt trước → CHẶN (chưa chắc thì không lập)", async () => {
    const { provider } = fakeProvider({ atProvider: { "DH1-DC1": { state: "LOOKUP_FAILED", message: "mạng", accountProblem: false } } });
    const plan = await planAdjustmentReference(provider, "DH1", [attempt("a", InvoiceLogStatus.FAILED, "DH1-DC1")]);
    expect(plan).toMatchObject({ kind: "BLOCK", block: { code: "HUBSELL_ADJUST_PRIOR_UNCHECKED", scope: "TRANSIENT" } });
  });

  it("nhà cung cấp có tờ mang mã đó nhưng chưa phát hành xong / không đọc được số → CHẶN", async () => {
    const pending = fakeProvider({ atProvider: { "DH1-DC1": found({ issued: false }) } });
    expect(
      await planAdjustmentReference(pending.provider, "DH1", [attempt("a", InvoiceLogStatus.FAILED, "DH1-DC1")])
    ).toMatchObject({ kind: "BLOCK", block: { code: "HUBSELL_ADJUST_PRIOR_IN_PROGRESS" } });
    const unreadable = fakeProvider({ atProvider: { "DH1-DC1": found({ invoiceNo: null }) } });
    expect(
      await planAdjustmentReference(unreadable.provider, "DH1", [attempt("a", InvoiceLogStatus.FAILED, "DH1-DC1")])
    ).toMatchObject({ kind: "BLOCK", block: { code: "HUBSELL_ADJUST_PRIOR_UNREADABLE", scope: "ORDER" } });
  });

  it("tờ trước đã lập thật rồi bị xóa (ghi CANCELLED, hoặc ghi hỏng mà nhà cung cấp báo đã xóa) → mã MỚI, số kế tiếp", async () => {
    const cancelled = fakeProvider({});
    expect(
      await planAdjustmentReference(cancelled.provider, "DH1", [attempt("a", InvoiceLogStatus.CANCELLED, "DH1-DC1")])
    ).toEqual({ kind: "USE", refId: "DH1-DC2" });
    expect(cancelled.lookups).toEqual([]);
    const ghost = fakeProvider({ atProvider: { "DH1-DC1": found({ deleted: true }) } });
    expect(
      await planAdjustmentReference(ghost.provider, "DH1", [attempt("a", InvoiceLogStatus.FAILED, "DH1-DC1")])
    ).toEqual({ kind: "USE", refId: "DH1-DC2" });
  });

  it("nhà cung cấp KHÔNG nhận lại mã của lượt bị từ chối → mã mới dù lượt trước hỏng", async () => {
    const { provider } = fakeProvider({ capabilities: { referenceReusableAfterReject: false } });
    expect(
      await planAdjustmentReference(provider, "DH1", [attempt("a", InvoiceLogStatus.FAILED, "DH1-DC1")])
    ).toEqual({ kind: "USE", refId: "DH1-DC2" });
  });

  it("nhà cung cấp không tra ngược được → cách cũ: mỗi lượt một mã mới, không gọi tra", async () => {
    const { provider, lookups } = fakeProvider({ noLookup: true });
    expect(
      await planAdjustmentReference(provider, "DH1", [
        attempt("a", InvoiceLogStatus.FAILED, "DH1-DC1"),
        attempt("b", InvoiceLogStatus.FAILED, null),
      ])
    ).toEqual({ kind: "USE", refId: "DH1-DC3" });
    expect(lookups).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("B. Luồng lập hóa đơn điều chỉnh trên database", () => {
  let fx: StockFixture;
  let productId: string;
  let seq = 0;
  /** "Sổ" của nhà cung cấp giả: mã tham chiếu → tờ đang có. */
  let atProvider: Record<string, ReferenceLookup>;
  let createCalls: CreateInvoiceInput[];
  let createResult: (input: CreateInvoiceInput) => InvoiceResult;

  const issuedNow = (input: CreateInvoiceInput): InvoiceResult => {
    seq += 1;
    const invoiceNo = `T${String(seq).padStart(7, "0")}`;
    const transactionId = `TEST-ADJ-${fx.suffix}-${seq}`;
    atProvider[input.orderCode] = found({ invoiceNo, transactionId });
    return { status: InvoiceLogStatus.ISSUED, invoiceNo, transactionId };
  };

  /** Phát hành một hóa đơn gốc qua luồng thật; nhà cung cấp giả ghi nhận tờ đó. */
  async function issuedOriginal(): Promise<{ id: string; orderCode: string; invoiceNo: string }> {
    const orderId = await fx.createOrder(productId, 1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const r = await issueInvoiceForOrder(fx.userId, { userId: fx.userId }, order.orderCode);
    expect(r.ok).toBe(true);
    createCalls.length = 0;
    return { id: r.log!.id, orderCode: order.orderCode, invoiceNo: r.log!.invoiceNo! };
  }

  const adjust = (originalId: string) =>
    issueAdjustmentForOrder(fx.userId, { userId: fx.userId }, originalId, "Khách trả hàng hoàn tiền");

  beforeAll(async () => {
    fx = await createStockFixture("invadj");
    productId = await fx.createProduct(100);
    await prisma.invoiceConfig.create({
      data: { ownerId: fx.userId, provider: "MISA", invoicePattern: "1", invoiceSeries: "1C26TAA" },
    });
  });

  beforeEach(() => {
    atProvider = {};
    createCalls = [];
    createResult = issuedNow;
    providerHolder.current = {
      name: "MISA",
      capabilities: MISA_CAPABILITIES,
      async createInvoice(input: CreateInvoiceInput) {
        createCalls.push(input);
        return createResult(input);
      },
      async cancelInvoice() {
        return { status: InvoiceLogStatus.FAILED };
      },
      async checkStatus() {
        return { status: InvoiceLogStatus.FAILED };
      },
      async findByReference(reference: string) {
        return atProvider[reference] ?? NOT_FOUND;
      },
    } satisfies InvoiceProvider;
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it("hóa đơn gốc còn hiệu lực → lập điều chỉnh với mã <mã đơn>-DC1, trỏ đúng số hóa đơn gốc", async () => {
    const original = await issuedOriginal();
    const r = await adjust(original.id);
    expect(r.ok).toBe(true);
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].orderCode).toBe(`${original.orderCode}-DC1`);
    expect(createCalls[0].adjustment?.orgInvNo).toBe(original.invoiceNo);
  });

  it("hóa đơn gốc đã bị xóa bên nhà cung cấp → CHẶN: không gọi lập, không ghi dòng nào, trả lý do + việc nên làm", async () => {
    const original = await issuedOriginal();
    atProvider[original.orderCode] = found({ invoiceNo: original.invoiceNo, deleted: true });
    const r = await adjust(original.id);
    expect(r.ok).toBe(false);
    expect(r.httpStatus).toBe(409);
    expect(r.errorCode).toBe("HUBSELL_ADJUST_ORIGINAL_DELETED");
    expect(r.reason).toContain(original.invoiceNo);
    expect(r.suggestion).toBeTruthy();
    expect(r.error).toContain("Việc nên làm:");
    expect(createCalls).toHaveLength(0);
    expect(await prisma.invoiceLog.count({ where: { adjustmentForLogId: original.id } })).toBe(0);
  });

  it("lượt trước ghi HỎNG nhưng nhà cung cấp đã lập → nối lại số hóa đơn, KHÔNG lập tờ thứ hai", async () => {
    const original = await issuedOriginal();
    // Lượt 1: nhà cung cấp lập xong nhưng Hubsell nhận về lỗi mạng.
    createResult = (input) => {
      atProvider[input.orderCode] = found({ invoiceNo: "DC-DA-LAP", transactionId: `TEST-ADJ-${fx.suffix}-ghost` });
      return { status: InvoiceLogStatus.FAILED, errorMessage: "Không kết nối được", errorScope: "TRANSIENT" };
    };
    const first = await adjust(original.id);
    expect(first.ok).toBe(false);
    expect(createCalls).toHaveLength(1);

    // Lượt 2: nếu lập tiếp sẽ thành hai hóa đơn điều chỉnh.
    createResult = issuedNow;
    const second = await adjust(original.id);
    expect(second.ok).toBe(true);
    expect(createCalls).toHaveLength(1); // không gọi lập thêm
    expect(second.log!.invoiceNo).toBe("DC-DA-LAP");
    expect(second.log!.id).toBe(first.log!.id); // đúng dòng của lượt 1

    const logs = await prisma.invoiceLog.findMany({ where: { adjustmentForLogId: original.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: InvoiceLogStatus.ISSUED, providerRef: `${original.orderCode}-DC1` });
    expect(logs[0].issuedAt?.getTime()).toBe(logs[0].createdAt.getTime());
    const history = await prisma.invoiceStatusHistory.findMany({
      where: { invoiceLogId: logs[0].id },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((h) => `${h.fromStatus}>${h.toStatus}`)).toEqual(["PENDING>FAILED", "FAILED>ISSUED"]);
    expect(history[1].note).toContain("Nối lại");

    // Lượt 3: đã có điều chỉnh → báo đã điều chỉnh, vẫn không gọi lập.
    const third = await adjust(original.id);
    expect(third.httpStatus).toBe(409);
    expect(createCalls).toHaveLength(1);
  });

  it("lượt trước bị từ chối thật → lượt sau dùng LẠI đúng mã tham chiếu cũ", async () => {
    const original = await issuedOriginal();
    createResult = () => ({ status: InvoiceLogStatus.FAILED, errorMessage: "NCC từ chối", errorScope: "ORDER" });
    expect((await adjust(original.id)).ok).toBe(false);
    createResult = issuedNow;
    expect((await adjust(original.id)).ok).toBe(true);
    expect(createCalls.map((c) => c.orderCode)).toEqual([`${original.orderCode}-DC1`, `${original.orderCode}-DC1`]);
    const logs = await prisma.invoiceLog.findMany({
      where: { adjustmentForLogId: original.id },
      orderBy: { createdAt: "asc" },
    });
    expect(logs.map((l) => l.status)).toEqual([InvoiceLogStatus.FAILED, InvoiceLogStatus.ISSUED]);
    expect(logs.map((l) => l.providerRef)).toEqual([`${original.orderCode}-DC1`, `${original.orderCode}-DC1`]);
  });

  it("không tra lại được lượt trước → CHẶN tạm thời, không gọi lập", async () => {
    const original = await issuedOriginal();
    createResult = () => ({ status: InvoiceLogStatus.FAILED, errorMessage: "Không kết nối được", errorScope: "TRANSIENT" });
    await adjust(original.id);
    createCalls.length = 0;
    atProvider[`${original.orderCode}-DC1`] = { state: "LOOKUP_FAILED", message: "mạng", accountProblem: false };
    const r = await adjust(original.id);
    expect(r).toMatchObject({ ok: false, httpStatus: 502, errorCode: "HUBSELL_ADJUST_PRIOR_UNCHECKED", errorScope: "TRANSIENT" });
    expect(createCalls).toHaveLength(0);
  });
});
