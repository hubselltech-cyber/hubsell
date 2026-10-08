// ============================================================
// TỜ NHÁP CHỜ CHỦ SHOP KÝ — lát T1 luồng tenant (08/10/2026). Phần KHÔNG cần database:
//   · luật hạn ký / nhịp hỏi / kế hoạch áp kết quả (draft-signing.ts);
//   · adapter MISA rẽ đường theo phương thức ký: eSign/USB → tờ nháp (web app), HSM →
//     cổng phát hành; tra lô tờ nháp (findDrafts); tra ngược hỏi cả hai dạng mã.
// Hàm gọi MISA được thay bằng hàm giả theo đúng hành vi đã thấy trên sandbox 07/10 và tờ
// thật 00000001 của HQ (docs/HOA-DON-HQ-KY-NEN-KHAO-SAT-07-10.md mục 12–15).
// ============================================================
import "./load-env";
import { InvoiceLogStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { statusMock, publishMock, webListMock, insertMock } = vi.hoisted(() => ({
  statusMock: vi.fn(),
  publishMock: vi.fn(),
  webListMock: vi.fn(),
  insertMock: vi.fn(),
}));

vi.mock("../invoice/misa-einvoice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../invoice/misa-einvoice")>();
  return { ...actual, getInvoiceStatuses: statusMock, publishStandardInvoice: publishMock };
});
vi.mock("../invoice/misa-invoiceweb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../invoice/misa-invoiceweb")>();
  return { ...actual, getWebInvoices: webListMock, insertWebDraft: insertMock };
});

import {
  AWAITING_SIGNATURE_CODE,
  DRAFT_GONE_MIN_AGE_MS,
  DRAFT_RECHECK_MS,
  DRAFT_RECHECK_OLD_MS,
  DRAFT_WATCH_WINDOW_MS,
  draftNextCheckAt,
  isDeferredAtProvider,
  isSignOverdue,
  NUMBER_PENDING_CODE,
  planDraftFollow,
  signDeadline,
  type DraftFollowLog,
} from "../invoice/draft-signing";
import { CQT_FIRST_CHECK_MS } from "../invoice/cqt-follow";
import { MisaInvoiceProvider, type MisaProviderConfig } from "../invoice/misa-provider";
import { MEINVOICE_WEB_INVOICES_URL, usesWebDraft, webRefIdFor } from "../invoice/misa-invoiceweb";
import type { CreateInvoiceInput } from "../invoice/types";

const HOUR = 60 * 60_000;
const MIN = 60_000;

const cfgWith = (signMethod: string): MisaProviderConfig => ({
  taxCode: "0101243150",
  companyName: "SHOP THỬ",
  companyAddress: "Hà Nội",
  clientId: "cid",
  secretKey: "sec",
  meinvoiceUsername: "u",
  meinvoicePassword: "p",
  invoicePattern: "1",
  invoiceSeries: "1C26TAA",
  defaultUnitName: "Cái",
  signMethod,
  esignClientId: null,
  esignSecretKey: null,
  esignUsername: null,
  esignPassword: null,
  certSerial: null,
  defaultInvoiceType: "STANDARD",
});

const INPUT: CreateInvoiceInput = {
  orderCode: "DH-T1-001",
  buyerName: "Bán cho người tiêu dùng",
  lines: [
    { name: "Áo thun", sku: "AT01", unitName: "Cái", quantity: 1, unitPrice: 90909, vatRate: 10, amountWithoutVat: 90909, vatAmount: 9091 },
  ],
  totalAmount: 100000,
};

const webItem = (
  over: Partial<{ invoiceNo: string | null; transactionId: string | null; publishStatus: number; issued: boolean }> = {}
) => ({
  refId: webRefIdFor(INPUT.orderCode).toUpperCase(), // MISA có thể trả GUID chữ hoa
  invoiceNo: null,
  transactionId: null,
  publishStatus: 0,
  eInvoiceStatus: 1,
  issued: false,
  raw: {},
  ...over,
});

beforeEach(() => {
  statusMock.mockReset();
  publishMock.mockReset();
  webListMock.mockReset();
  insertMock.mockReset();
  statusMock.mockResolvedValue([]);
  webListMock.mockResolvedValue([]);
  insertMock.mockResolvedValue({ refId: webRefIdFor(INPUT.orderCode), invSeries: "1C26TAA", raw: {} });
});

describe("Phương thức ký nào đi tờ nháp", () => {
  it("eSign và USB token → tờ nháp; HSM → cổng phát hành", () => {
    expect(usesWebDraft("ESIGN_CLOUD")).toBe(true);
    expect(usesWebDraft("USB_TOKEN")).toBe(true);
    expect(usesWebDraft("HSM")).toBe(false);
  });
});

describe("Hạn ký (NĐ 254/2026: ngày ký chậm nhất là ngày làm việc tiếp theo kể từ ngày lập)", () => {
  // 2026-10-05 là Thứ Hai (giờ VN).
  const vn = (iso: string) => new Date(`${iso}+07:00`);
  it("Thứ Hai → hết Thứ Ba; Thứ Năm → hết Thứ Sáu", () => {
    expect(signDeadline(vn("2026-10-05T09:00:00")).toISOString()).toBe(vn("2026-10-06T23:59:59.999").toISOString());
    expect(signDeadline(vn("2026-10-08T23:30:00")).toISOString()).toBe(vn("2026-10-09T23:59:59.999").toISOString());
  });
  it("Thứ Sáu / Thứ Bảy / Chủ nhật → hết Thứ Hai kế", () => {
    const mondayEnd = vn("2026-10-12T23:59:59.999").toISOString();
    expect(signDeadline(vn("2026-10-09T10:00:00")).toISOString()).toBe(mondayEnd);
    expect(signDeadline(vn("2026-10-10T10:00:00")).toISOString()).toBe(mondayEnd);
    expect(signDeadline(vn("2026-10-11T10:00:00")).toISOString()).toBe(mondayEnd);
  });
  it("quá hạn khi đã sang ngày sau hạn (giờ VN), không phải khi còn trong ngày hạn", () => {
    const pushed = vn("2026-10-05T09:00:00");
    expect(isSignOverdue(pushed, vn("2026-10-06T22:00:00"))).toBe(false);
    expect(isSignOverdue(pushed, vn("2026-10-07T00:00:01"))).toBe(true);
  });
});

describe("Nhịp hỏi tờ nháp", () => {
  const since = new Date("2026-10-08T03:00:00Z");
  it("2 ngày đầu: 30 phút; sau đó 6 giờ", () => {
    expect(draftNextCheckAt(since, new Date(since.getTime() + HOUR)).getTime()).toBe(since.getTime() + HOUR + DRAFT_RECHECK_MS);
    const later = new Date(since.getTime() + DRAFT_WATCH_WINDOW_MS + MIN);
    expect(draftNextCheckAt(since, later).getTime()).toBe(later.getTime() + DRAFT_RECHECK_OLD_MS);
  });
});

describe("Kế hoạch áp kết quả tra tờ nháp (planDraftFollow)", () => {
  const now = new Date("2026-10-08T05:00:00Z");
  const log = (ageMs: number): DraftFollowLog => ({
    id: "l1",
    ownerId: "o1",
    orderId: "ord1",
    orderCode: "DH-1",
    provider: "MISA",
    providerRef: "DH-1",
    adjustmentForLogId: null,
    awaitingSignatureAt: new Date(now.getTime() - ageMs),
    createdAt: new Date(now.getTime() - ageMs),
  });

  it("adapter không trả gì / còn chờ → hẹn hỏi lại theo nhịp", () => {
    expect(planDraftFollow(log(HOUR), undefined, now)).toEqual({ kind: "WAIT", next: new Date(now.getTime() + DRAFT_RECHECK_MS) });
    expect(planDraftFollow(log(HOUR), { state: "WAITING" }, now)).toMatchObject({ kind: "WAIT" });
  });
  it("đã ký có số → ĐÃ PHÁT HÀNH, giờ hỏi cơ quan thuế tính từ lúc ký; có mã tra cứu mà chưa có số → giữ đang chờ", () => {
    expect(planDraftFollow(log(HOUR), { state: "SIGNED", invoiceNo: "00000007", transactionId: "TX7" }, now)).toEqual({
      kind: "SIGNED",
      status: InvoiceLogStatus.ISSUED,
      invoiceNo: "00000007",
      transactionId: "TX7",
      next: new Date(now.getTime() + CQT_FIRST_CHECK_MS),
    });
    expect(planDraftFollow(log(HOUR), { state: "SIGNED", invoiceNo: null, transactionId: "TX8" }, now)).toMatchObject({
      kind: "SIGNED",
      status: InvoiceLogStatus.PENDING,
    });
  });
  it("không thấy tờ: vừa đẩy thì CHƯA kết luận; đẩy đủ lâu → tờ đã bị xóa", () => {
    expect(planDraftFollow(log(DRAFT_GONE_MIN_AGE_MS - MIN), { state: "GONE" }, now)).toMatchObject({ kind: "WAIT" });
    expect(planDraftFollow(log(DRAFT_GONE_MIN_AGE_MS + MIN), { state: "GONE" }, now)).toEqual({ kind: "GONE", deletedAtProvider: false });
    expect(planDraftFollow(log(MIN), { state: "DELETED" }, now)).toEqual({ kind: "GONE", deletedAtProvider: true });
  });
});

describe("Kết quả 'đã giao cho nhà cung cấp, chưa xong' (isDeferredAtProvider)", () => {
  it("chờ ký / chờ số là deferred; lỗi thường và thành công thì không", () => {
    expect(isDeferredAtProvider({ awaitingSignature: true })).toBe(true);
    expect(isDeferredAtProvider({ errorCode: NUMBER_PENDING_CODE })).toBe(true);
    expect(isDeferredAtProvider({ errorCode: "InvoiceDuplicated" })).toBe(false);
    expect(isDeferredAtProvider({})).toBe(false);
  });
});

describe("Adapter MISA — đường tờ nháp (eSign / USB token)", () => {
  it("chưa có tờ ở web lẫn cổng tra cứu → đẩy nháp MỘT lần, trả đang chờ ký (không phải lỗi)", async () => {
    const r = await new MisaInvoiceProvider(cfgWith("ESIGN_CLOUD")).createInvoice(INPUT);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(publishMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: InvoiceLogStatus.PENDING, awaitingSignature: true, errorCode: AWAITING_SIGNATURE_CODE, vatAmount: 9091 });
    expect(r.transactionId).toBeUndefined();
    expect(r.errorMessage).toContain(MEINVOICE_WEB_INVOICES_URL);
    expect(r.errorMessage).toContain("đã lập tờ nháp");
    // Web được hỏi theo UUID v5 của mã đơn (RefID kiểu GUID), cổng tra cứu cũng vậy.
    expect(webListMock).toHaveBeenCalledWith([webRefIdFor(INPUT.orderCode)], expect.anything());
    expect(statusMock).toHaveBeenCalledWith([webRefIdFor(INPUT.orderCode)], expect.anything(), "refId");
  });

  it("USB token cũng đi tờ nháp", async () => {
    const r = await new MisaInvoiceProvider(cfgWith("USB_TOKEN")).createInvoice(INPUT);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(r.awaitingSignature).toBe(true);
  });

  it("tờ nháp lượt trước còn chờ trên web → KHÔNG đẩy thêm, lời nhắn nói 'đang chờ ký'", async () => {
    webListMock.mockResolvedValue([webItem()]);
    const r = await new MisaInvoiceProvider(cfgWith("ESIGN_CLOUD")).createInvoice(INPUT);
    expect(insertMock).not.toHaveBeenCalled();
    expect(statusMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: InvoiceLogStatus.PENDING, awaitingSignature: true });
    expect(r.errorMessage).toContain("đang chờ ký");
  });

  it("chủ shop đã ký trên web (có số + mã tra cứu) → ĐÃ PHÁT HÀNH, không đẩy gì", async () => {
    webListMock.mockResolvedValue([webItem({ invoiceNo: "00000012", transactionId: "TX12", publishStatus: 1, issued: true })]);
    const r = await new MisaInvoiceProvider(cfgWith("ESIGN_CLOUD")).createInvoice(INPUT);
    expect(insertMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: InvoiceLogStatus.ISSUED, invoiceNo: "00000012", transactionId: "TX12", vatAmount: 9091 });
    expect(r.awaitingSignature).toBeUndefined();
  });

  it("đã ký, có mã tra cứu mà chưa có số → đang chờ + mã (vòng hỏi trạng thái lấy số)", async () => {
    webListMock.mockResolvedValue([webItem({ transactionId: "TX13", publishStatus: 1 })]);
    const r = await new MisaInvoiceProvider(cfgWith("ESIGN_CLOUD")).createInvoice(INPUT);
    expect(r).toMatchObject({ status: InvoiceLogStatus.PENDING, transactionId: "TX13", errorCode: NUMBER_PENDING_CODE });
    expect(r.awaitingSignature).toBeUndefined();
  });

  it("web không còn tờ nhưng cổng tra cứu có tờ đã phát hành (lưới đỡ) → nối số, không đẩy nháp trùng", async () => {
    statusMock.mockResolvedValue([
      { transactionId: "TX20", publishStatus: 1, sendTaxStatus: 2, isDeleted: false, invoiceNo: "00000020", refId: webRefIdFor(INPUT.orderCode), raw: {} },
    ]);
    const r = await new MisaInvoiceProvider(cfgWith("ESIGN_CLOUD")).createInvoice(INPUT);
    expect(insertMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: InvoiceLogStatus.ISSUED, invoiceNo: "00000020", transactionId: "TX20" });
  });

  it("đẩy nháp bị từ chối (vd ký hiệu không có mẫu) → HỎNG kèm lý do, không phải chưa rõ", async () => {
    insertMock.mockRejectedValue(new Error("meInvoice web không có mẫu đang hoạt động cho ký hiệu 1C26TAA"));
    const r = await new MisaInvoiceProvider(cfgWith("ESIGN_CLOUD")).createInvoice(INPUT);
    expect(r.status).toBe(InvoiceLogStatus.FAILED);
    expect(r.awaitingSignature).toBeUndefined();
    expect(r.outcomeUnknown).toBeUndefined();
    expect(r.errorMessage).toContain("không có mẫu");
  });

  it("HSM vẫn đi cổng phát hành, không đụng web app", async () => {
    publishMock.mockResolvedValue({ invoiceNo: "00000030", transactionId: "TX30" });
    const r = await new MisaInvoiceProvider(cfgWith("HSM")).createInvoice(INPUT);
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(webListMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: InvoiceLogStatus.ISSUED, invoiceNo: "00000030" });
  });
});

describe("Adapter MISA — tra lô tờ nháp (findDrafts)", () => {
  it("web: đã ký / còn chờ; không có trên web → hỏi cổng tra cứu: đã xóa; cả hai không có → GONE", async () => {
    const refs = ["DH-A", "DH-B", "DH-C", "DH-D"];
    const guid = (r: string) => webRefIdFor(r);
    webListMock.mockResolvedValue([
      { refId: guid("DH-A").toUpperCase(), invoiceNo: "00000001", transactionId: "TXA", publishStatus: 1, eInvoiceStatus: 1, issued: true, raw: {} },
      { refId: guid("DH-B"), invoiceNo: null, transactionId: null, publishStatus: 0, eInvoiceStatus: 1, issued: false, raw: {} },
    ]);
    statusMock.mockResolvedValue([
      { transactionId: "TXC", publishStatus: 1, sendTaxStatus: 2, isDeleted: true, invoiceNo: "00000003", refId: guid("DH-C"), raw: {} },
    ]);
    const r = await new MisaInvoiceProvider(cfgWith("ESIGN_CLOUD")).findDrafts(refs);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.found.get("DH-A")).toEqual({ state: "SIGNED", invoiceNo: "00000001", transactionId: "TXA" });
    expect(r.found.get("DH-B")).toEqual({ state: "WAITING" });
    expect(r.found.get("DH-C")).toEqual({ state: "DELETED" });
    expect(r.found.get("DH-D")).toEqual({ state: "GONE" });
    // Cổng tra cứu chỉ được hỏi cho các mã web không có.
    expect(statusMock).toHaveBeenCalledWith([guid("DH-C"), guid("DH-D")], expect.anything(), "refId");
  });

  it("hỏi web lỗi → ok: false, không ném", async () => {
    webListMock.mockRejectedValue(new Error("mất mạng"));
    const r = await new MisaInvoiceProvider(cfgWith("ESIGN_CLOUD")).findDrafts(["DH-A"]);
    expect(r).toMatchObject({ ok: false, accountProblem: false });
  });
});

describe("Adapter MISA — tra ngược theo mã tham chiếu hỏi cả hai dạng mã", () => {
  it("mã Hubsell + UUID v5 của nó trong MỘT lệnh", async () => {
    await new MisaInvoiceProvider(cfgWith("HSM")).findByReference("DH-9");
    expect(statusMock).toHaveBeenCalledWith(["DH-9", webRefIdFor("DH-9")], expect.anything(), "refId");
  });
});
