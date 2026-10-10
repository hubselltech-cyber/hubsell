// ============================================================
// GOM TỜ NHÁP 20 TỜ MỘT LỆNH — đường tờ nháp MISA (10/10/2026, anh Trung chốt).
// Không database, không chạm MISA: hai nhóm invoiceweb / einvoice thay bằng mock.
//
//   1. mapWebInsertResponse (hàm thuần): ghép theo RefID; tờ MISA bỏ khỏi câu trả lời
//      (đo sandbox 10/10: trùng RefID bị bỏ lặng lẽ) → HUBSELL_DRAFT_NOT_IN_RESPONSE;
//      chỉ ghép theo vị trí khi MISA không trả RefID nào và số phần tử khớp.
//   2. Bảng khả năng: eSign / USB → createBatchSize 20; HSM → 1.
//   3. createInvoices một lô: tờ đã ký trên web → ISSUED; tờ nháp đã có → chờ ký (không
//      đẩy lại); tờ không có trên web nhưng cổng tra cứu thấy đã ký → ISSUED; tờ thiếu
//      → MỘT lệnh insert đúng những tờ đó.
//   4. Tờ không có trong câu trả lời: tra lại web, thấy → chờ ký; không thấy → lỗi TẠM.
//   5. Lệnh insert đứt mạng: các tờ chưa có kết quả mang lỗi TẠM, tờ đã kết luận giữ nguyên.
//   6. Cổng HSM (không gom): createInvoices đi lần lượt qua createInvoice.
// ============================================================
import { InvoiceLogStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getWebInvoices: vi.fn(),
  insertWebDraftPayloads: vi.fn(),
  findWebTemplate: vi.fn(),
  getInvoiceStatuses: vi.fn(),
  publishStandardInvoice: vi.fn(),
}));

vi.mock("../invoice/misa-invoiceweb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../invoice/misa-invoiceweb")>();
  return {
    ...actual,
    getWebInvoices: m.getWebInvoices,
    insertWebDraftPayloads: m.insertWebDraftPayloads,
    findWebTemplate: m.findWebTemplate,
  };
});
vi.mock("../invoice/misa-einvoice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../invoice/misa-einvoice")>();
  return { ...actual, getInvoiceStatuses: m.getInvoiceStatuses, publishStandardInvoice: m.publishStandardInvoice };
});
vi.mock("../invoice/misa-safety", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../invoice/misa-safety")>();
  return { ...actual, isPublishAllowed: () => true, assertPublishAllowed: () => undefined };
});

import { AWAITING_SIGNATURE_CODE } from "../invoice/draft-signing";
import { InvoiceProviderError } from "../invoice/invoice-errors";
import {
  mapWebInsertResponse,
  WEB_INSERT_BATCH_SIZE,
  WEB_INSERT_NOT_IN_RESPONSE,
  webRefIdFor,
  type WebDraftPayload,
} from "../invoice/misa-invoiceweb";
import { MisaInvoiceProvider, type MisaProviderConfig } from "../invoice/misa-provider";
import type { CreateInvoiceInput } from "../invoice/types";

const cfg = (signMethod: string): MisaProviderConfig => ({
  defaultInvoiceType: "STANDARD",
  taxCode: "0101234567",
  companyName: "Shop thử",
  companyAddress: "Hà Nội",
  clientId: "cid",
  secretKey: "sec",
  meinvoiceUsername: "shop@test",
  meinvoicePassword: "x",
  invoicePattern: "1",
  invoiceSeries: "1C26TAA",
  defaultUnitName: "Cái",
  signMethod,
  esignClientId: null,
  esignSecretKey: null,
  esignUsername: null,
  esignPassword: null,
  certSerial: null,
});

const input = (orderCode: string): CreateInvoiceInput => ({
  orderCode,
  buyerName: `Khách ${orderCode}`,
  lines: [{ name: "Áo", sku: "AO", unitName: "Cái", quantity: 1, unitPrice: 100_000, vatRate: 10, amountWithoutVat: 100_000, vatAmount: 10_000 }],
  totalAmount: 110_000,
});
const ref = (code: string) => webRefIdFor(code);
const webItem = (code: string, signed: boolean) => ({
  refId: ref(code).toUpperCase(), // MISA có thể trả GUID chữ hoa
  invoiceNo: signed ? "00000001" : null,
  transactionId: signed ? `TX-${code}` : null,
  publishStatus: signed ? 1 : 0,
  eInvoiceStatus: 1,
  issued: signed,
  raw: {},
});
const acceptAll = (payloads: WebDraftPayload[]) => ({
  items: payloads.map((p) => ({ refId: p.RefID, errorCode: null, description: null, raw: {} })),
  raw: {},
});

beforeEach(() => {
  vi.clearAllMocks();
  m.findWebTemplate.mockResolvedValue({ templateId: "tpl-1", invSeries: "1C26TAA", invTemplateNo: "1", templateName: "Mẫu", inactive: false });
  m.getInvoiceStatuses.mockResolvedValue([]);
  m.insertWebDraftPayloads.mockImplementation(async (payloads: WebDraftPayload[]) => acceptAll(payloads));
});

describe("mapWebInsertResponse (hàm thuần)", () => {
  it("ghép theo RefID không phân biệt hoa thường; tờ thiếu trong câu trả lời → NOT_IN_RESPONSE", () => {
    const out = mapWebInsertResponse(
      ["aaa-1", "bbb-2", "ccc-3"],
      [{ RefID: "AAA-1", InvSeries: "1C26TAA" }, { RefID: "ccc-3", ErrorCode: "VATRateInvalid", DescriptionErrorCode: "Thuế sai" }]
    );
    expect(out.map((x) => [x.refId, x.errorCode])).toEqual([
      ["aaa-1", null],
      ["bbb-2", WEB_INSERT_NOT_IN_RESPONSE],
      ["ccc-3", "VATRateInvalid"],
    ]);
    expect(out[2].description).toBe("Thuế sai");
  });

  it("MISA không trả RefID: khớp số phần tử thì ghép theo vị trí, lệch thì mọi tờ đều NOT_IN_RESPONSE", () => {
    expect(mapWebInsertResponse(["a", "b"], [{ ErrorCode: "" }, { ErrorCode: "X" }]).map((x) => x.errorCode)).toEqual([null, "X"]);
    expect(mapWebInsertResponse(["a", "b"], [{}]).map((x) => x.errorCode)).toEqual([WEB_INSERT_NOT_IN_RESPONSE, WEB_INSERT_NOT_IN_RESPONSE]);
    expect(mapWebInsertResponse(["a"], null).map((x) => x.errorCode)).toEqual([WEB_INSERT_NOT_IN_RESPONSE]);
  });
});

describe("Bảng khả năng theo phương thức ký", () => {
  it("eSign / USB gom 20 tờ một lệnh; HSM một tờ một lệnh", () => {
    expect(WEB_INSERT_BATCH_SIZE).toBe(20);
    expect(new MisaInvoiceProvider(cfg("ESIGN_CLOUD")).capabilities.createBatchSize).toBe(20);
    expect(new MisaInvoiceProvider(cfg("USB_TOKEN")).capabilities.createBatchSize).toBe(20);
    expect(new MisaInvoiceProvider(cfg("HSM")).capabilities.createBatchSize).toBe(1);
  });
});

describe("createInvoices — đường tờ nháp theo lô", () => {
  it("đã ký trên web → ISSUED; nháp đã có → chờ ký; cổng tra cứu thấy → ISSUED; thiếu → MỘT lệnh insert đúng tờ thiếu", async () => {
    m.getWebInvoices.mockResolvedValueOnce([webItem("A", true), webItem("B", false)]);
    m.getInvoiceStatuses.mockResolvedValueOnce([{ refId: ref("C"), transactionId: "TX-C", invoiceNo: "00000003", isDeleted: false }]);
    const p = new MisaInvoiceProvider(cfg("ESIGN_CLOUD"));

    const out = await p.createInvoices(["A", "B", "C", "D"].map(input));

    expect(out.map((r) => r.status)).toEqual([InvoiceLogStatus.ISSUED, InvoiceLogStatus.PENDING, InvoiceLogStatus.ISSUED, InvoiceLogStatus.PENDING]);
    expect(out[0]).toMatchObject({ invoiceNo: "00000001", transactionId: "TX-A", vatAmount: 10_000 });
    expect(out[1]).toMatchObject({ awaitingSignature: true, errorCode: AWAITING_SIGNATURE_CODE });
    expect(out[2]).toMatchObject({ invoiceNo: "00000003", transactionId: "TX-C" });
    expect(out[3]).toMatchObject({ awaitingSignature: true, errorCode: AWAITING_SIGNATURE_CODE });
    // Một lệnh getlist cho cả lô, một lệnh tra cứu cho tờ không có trên web, MỘT lệnh insert đúng tờ D.
    expect(m.getWebInvoices).toHaveBeenCalledTimes(1);
    expect(m.getWebInvoices.mock.calls[0][0]).toEqual(["A", "B", "C", "D"].map(ref));
    expect(m.getInvoiceStatuses).toHaveBeenCalledTimes(1);
    expect(m.getInvoiceStatuses.mock.calls[0][0]).toEqual([ref("C"), ref("D")]);
    expect(m.insertWebDraftPayloads).toHaveBeenCalledTimes(1);
    const payloads = m.insertWebDraftPayloads.mock.calls[0][0] as WebDraftPayload[];
    expect(payloads.map((x) => x.RefID)).toEqual([ref("D")]);
    expect(payloads[0].CustomField1).toBe("D");
  });

  it("tờ không có trong câu trả lời: tra lại thấy → chờ ký; không thấy → lỗi TẠM, lượt sau làm lại", async () => {
    m.getWebInvoices.mockResolvedValueOnce([]); // lô: chưa tờ nào trên web
    m.insertWebDraftPayloads.mockImplementationOnce(async (payloads: WebDraftPayload[]) => ({
      // MISA chỉ trả phần tử cho tờ đầu — hai tờ sau bị bỏ (trùng RefID)
      items: [
        { refId: payloads[0].RefID, errorCode: null, description: null, raw: {} },
        { refId: payloads[1].RefID, errorCode: WEB_INSERT_NOT_IN_RESPONSE, description: "bỏ", raw: null },
        { refId: payloads[2].RefID, errorCode: WEB_INSERT_NOT_IN_RESPONSE, description: "bỏ", raw: null },
      ],
      raw: {},
    }));
    m.getWebInvoices.mockResolvedValueOnce([webItem("Y", false)]); // tra lại: Y có, Z không
    const p = new MisaInvoiceProvider(cfg("ESIGN_CLOUD"));

    const out = await p.createInvoices(["X", "Y", "Z"].map(input));

    expect(out[0]).toMatchObject({ status: InvoiceLogStatus.PENDING, awaitingSignature: true });
    expect(out[1]).toMatchObject({ status: InvoiceLogStatus.PENDING, awaitingSignature: true });
    expect(out[2]).toMatchObject({ status: InvoiceLogStatus.FAILED, errorScope: "TRANSIENT", errorCode: WEB_INSERT_NOT_IN_RESPONSE });
    expect(m.getWebInvoices).toHaveBeenCalledTimes(2);
    expect(m.getWebInvoices.mock.calls[1][0]).toEqual([ref("Y"), ref("Z")]);
  });

  it("mã lỗi riêng tờ từ MISA → tờ đó FAILED, tờ khác trong lô vẫn chờ ký", async () => {
    m.getWebInvoices.mockResolvedValueOnce([]);
    m.insertWebDraftPayloads.mockImplementationOnce(async (payloads: WebDraftPayload[]) => ({
      items: [
        { refId: payloads[0].RefID, errorCode: null, description: null, raw: {} },
        { refId: payloads[1].RefID, errorCode: "VATRateInvalid", description: "Thuế suất không hợp lệ", raw: {} },
      ],
      raw: {},
    }));
    const out = await new MisaInvoiceProvider(cfg("ESIGN_CLOUD")).createInvoices(["P", "Q"].map(input));
    expect(out[0]).toMatchObject({ status: InvoiceLogStatus.PENDING, awaitingSignature: true });
    expect(out[1].status).toBe(InvoiceLogStatus.FAILED);
    expect(out[1].errorCode).toBe("VATRateInvalid");
    expect(out[1].awaitingSignature).toBeUndefined();
  });

  it("lệnh insert đứt mạng: tờ đã kết luận giữ nguyên, tờ chưa có kết quả mang lỗi TẠM 'chưa rõ tờ nháp'", async () => {
    m.getWebInvoices.mockResolvedValueOnce([webItem("A", true)]);
    m.insertWebDraftPayloads.mockRejectedValueOnce(new InvoiceProviderError("đứt", { network: true, publishSent: true }));
    const out = await new MisaInvoiceProvider(cfg("ESIGN_CLOUD")).createInvoices(["A", "B", "C"].map(input));
    expect(out[0]).toMatchObject({ status: InvoiceLogStatus.ISSUED, transactionId: "TX-A" });
    expect(out[1]).toMatchObject({ status: InvoiceLogStatus.FAILED, errorScope: "TRANSIENT", errorCode: "HUBSELL_DRAFT_UNKNOWN" });
    expect(out[2]).toMatchObject({ status: InvoiceLogStatus.FAILED, errorScope: "TRANSIENT", errorCode: "HUBSELL_DRAFT_UNKNOWN" });
  });

  it("đăng nhập / getlist hỏng trước khi insert: cả lô cùng một kết quả lỗi, không gọi insert", async () => {
    m.getWebInvoices.mockRejectedValueOnce(new InvoiceProviderError("meInvoice web từ chối", { code: "UnAuthorize", httpStatus: 401 }));
    const out = await new MisaInvoiceProvider(cfg("ESIGN_CLOUD")).createInvoices(["A", "B"].map(input));
    expect(out).toHaveLength(2);
    expect(out[0].status).toBe(InvoiceLogStatus.FAILED);
    expect(out[0].errorCode).toBe("UnAuthorize");
    expect(out[1]).toEqual(out[0]);
    expect(m.insertWebDraftPayloads).not.toHaveBeenCalled();
  });

  it("cổng HSM không gom: createInvoices đi lần lượt từng tờ qua createInvoice", async () => {
    const p = new MisaInvoiceProvider(cfg("HSM"));
    const single = vi.spyOn(p, "createInvoice").mockResolvedValue({ status: InvoiceLogStatus.ISSUED, invoiceNo: "1", transactionId: "T" });
    const out = await p.createInvoices(["A", "B"].map(input));
    expect(single).toHaveBeenCalledTimes(2);
    expect(out.map((r) => r.status)).toEqual([InvoiceLogStatus.ISSUED, InvoiceLogStatus.ISSUED]);
    expect(m.insertWebDraftPayloads).not.toHaveBeenCalled();
  });
});
