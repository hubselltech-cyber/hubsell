import { InvoiceLogStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// CỔNG CHỜ NHÀ CUNG CẤP HÓA ĐƠN (giai đoạn 2 bước 5, lát 1 — 02/10/2026):
//   1. Sổ đăng ký NCC là nguồn duy nhất: ai chọn được, ai "sắp ra mắt", ai giữ chỗ.
//   2. Công tắc phát hành riêng từng NCC; MISA giữ đúng biến đang dùng trên prod.
//   3. Bảng khả năng của MISA khớp kết quả bài thử sandbox 02/10.
//   4. Tra ngược theo mã tham chiếu tách bạch ba kết quả: thấy / không thấy / không tra được.
//   5. MISA báo trùng mã → nối lại tờ đã lập (hành vi có từ 19/09, nay đi qua tra ngược).
// Không gọi mạng: hai hàm gọi MISA được thay bằng hàm giả.
// ============================================================

const { publishMock, statusMock } = vi.hoisted(() => ({
  publishMock: vi.fn(),
  statusMock: vi.fn(),
}));

vi.mock("../invoice/misa-einvoice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../invoice/misa-einvoice")>();
  return { ...actual, publishStandardInvoice: publishMock, getInvoiceStatuses: statusMock };
});

import { InvoiceProviderError } from "../invoice/invoice-errors";
import { MISA_CAPABILITIES, MisaInvoiceProvider, type MisaProviderConfig } from "../invoice/misa-provider";
import { isPublishAllowed } from "../invoice/misa-safety";
import {
  createProvider,
  getProviderEntry,
  isComingSoonProvider,
  isListedProvider,
  listProviderEntries,
  providerPublishAllowed,
} from "../invoice/provider-registry";
import { isProviderPublishAllowed, publishSwitchEnvName } from "../invoice/publish-switch";
import type { CreateInvoiceInput } from "../invoice/types";

const CFG: MisaProviderConfig = {
  taxCode: "0101243150-732",
  companyName: "Shop test",
  companyAddress: "HN",
  clientId: null,
  secretKey: null,
  meinvoiceUsername: "u",
  meinvoicePassword: "p",
  invoicePattern: "1",
  invoiceSeries: "1C26TAA",
  defaultUnitName: "Cái",
  signMethod: "ESIGN_CLOUD",
  esignClientId: null,
  esignSecretKey: null,
  esignUsername: null,
  esignPassword: null,
  certSerial: null,
  defaultInvoiceType: "STANDARD",
};

const INPUT: CreateInvoiceInput = {
  orderCode: "DH-001",
  buyerName: "Bán cho người tiêu dùng",
  lines: [
    { name: "Áo", sku: "A1", quantity: 1, unitPrice: 10_000, vatRate: 10, amountWithoutVat: 10_000, vatAmount: 1_000 },
  ],
  totalAmount: 11_000,
};

const statusItem = (over: Record<string, unknown> = {}) => ({
  transactionId: "TX1",
  publishStatus: 1,
  sendTaxStatus: null,
  isDeleted: false,
  invoiceNo: "00000131",
  raw: {},
  ...over,
});

beforeEach(() => {
  publishMock.mockReset();
  statusMock.mockReset();
});

describe("Sổ đăng ký nhà cung cấp", () => {
  it("mã không trùng nhau; NCC ACTIVE nào cũng có adapter", () => {
    const entries = listProviderEntries();
    expect(new Set(entries.map((e) => e.code)).size).toBe(entries.length);
    for (const e of entries) {
      if (e.status === "ACTIVE") expect(e.create, `${e.code} thiếu adapter`).toBeTypeOf("function");
      else expect(e.create, `${e.code} chưa ACTIVE mà đã gắn adapter`).toBeUndefined();
    }
  });

  it("hôm nay chỉ MISA phát hành được", () => {
    expect(listProviderEntries().filter((e) => e.status === "ACTIVE").map((e) => e.code)).toEqual(["MISA"]);
  });

  it("form cấu hình: nhận NCC đã công bố, chặn lưu NCC sắp ra mắt — đúng danh sách trước 02/10", () => {
    const listed = ["MISA", "EASYINVOICE", "MINVOICE", "MATBAO", "VIETTEL", "VNPT", "BKAV", "CUSTOM"];
    const comingSoon = ["EASYINVOICE", "MINVOICE", "MATBAO", "VIETTEL", "VNPT", "BKAV"];
    expect(listProviderEntries().filter((e) => isListedProvider(e.code)).map((e) => e.code)).toEqual(listed);
    expect(listProviderEntries().filter((e) => isComingSoonProvider(e.code)).map((e) => e.code)).toEqual(comingSoon);
    expect(isListedProvider("KHONG-CO")).toBe(false);
    expect(isComingSoonProvider("MISA")).toBe(false);
    expect(isComingSoonProvider("CUSTOM")).toBe(false);
  });

  it("Hubtax: giữ chỗ mã, chưa nhận ở cấu hình, chưa có adapter, không phát hành được dù lỡ bật biến", () => {
    expect(getProviderEntry("HUBTAX")?.status).toBe("RESERVED");
    expect(isListedProvider("HUBTAX")).toBe(false);
    expect(isComingSoonProvider("HUBTAX")).toBe(false);
    expect(providerPublishAllowed("HUBTAX", { HUBTAX_ALLOW_PUBLISH: "1" })).toBe(false);
  });

  it("dựng adapter: MISA ra adapter MISA; NCC chưa có adapter / mã lạ ra null", () => {
    const row = { ...CFG, provider: "MISA" } as never;
    const creds = { clientId: null, secretKey: null, apiKey: null, customApiUrl: null, partnerCode: null };
    expect(createProvider(row, creds)?.name).toBe("MISA");
    for (const code of ["BKAV", "CUSTOM", "HUBTAX", "KHONG-CO"]) {
      expect(createProvider({ ...CFG, provider: code } as never, creds), code).toBeNull();
    }
  });
});

describe("Công tắc phát hành riêng từng NCC", () => {
  const saved = process.env.MISA_ALLOW_PUBLISH;
  afterEach(() => {
    if (saved === undefined) delete process.env.MISA_ALLOW_PUBLISH;
    else process.env.MISA_ALLOW_PUBLISH = saved;
  });

  it("tên biến = <MÃ>_ALLOW_PUBLISH; MISA giữ đúng biến đang dùng trên prod", () => {
    expect(publishSwitchEnvName("MISA")).toBe("MISA_ALLOW_PUBLISH");
    expect(publishSwitchEnvName(" easyinvoice ")).toBe("EASYINVOICE_ALLOW_PUBLISH");
  });

  it("mặc định CHẶN; chỉ '1' / 'true' mới mở; bật NCC này không mở NCC khác", () => {
    expect(isProviderPublishAllowed("MISA", {})).toBe(false);
    expect(isProviderPublishAllowed("MISA", { MISA_ALLOW_PUBLISH: " TRUE " })).toBe(true);
    expect(isProviderPublishAllowed("MISA", { MISA_ALLOW_PUBLISH: "yes" })).toBe(false);
    expect(isProviderPublishAllowed("EASYINVOICE", { MISA_ALLOW_PUBLISH: "1" })).toBe(false);
    expect(providerPublishAllowed("MISA", { MISA_ALLOW_PUBLISH: "1" })).toBe(true);
    // Sắp ra mắt: chưa có adapter thì bật biến cũng không phát hành được.
    expect(providerPublishAllowed("BKAV", { BKAV_ALLOW_PUBLISH: "1" })).toBe(false);
  });

  it("chốt cũ của MISA (misa-safety) đọc cùng một luật", () => {
    process.env.MISA_ALLOW_PUBLISH = "1";
    expect(isPublishAllowed()).toBe(true);
    delete process.env.MISA_ALLOW_PUBLISH;
    expect(isPublishAllowed()).toBe(false);
  });
});

describe("Bảng khả năng của MISA (kết quả thử sandbox 02/10/2026)", () => {
  it("đổi một dòng là phải có lý do: test này khóa bảng", () => {
    expect(MISA_CAPABILITIES).toEqual({
      sequentialIssue: true,
      dedupesByReference: true,
      referenceReusableAfterReject: true,
      findByReference: { supported: true, settleSeconds: 60 },
      statusBatchSize: 50,
      webhook: false,
      cancelViaApi: false,
      validatesAdjustmentOriginal: false,
    });
    expect(new MisaInvoiceProvider(CFG).capabilities).toBe(MISA_CAPABILITIES);
  });
});

describe("Tra ngược theo mã tham chiếu (MISA)", () => {
  it("MISA trả rỗng → KHÔNG THẤY; hỏi theo mã tham chiếu chứ không theo mã tra cứu", async () => {
    statusMock.mockResolvedValue([]);
    const r = await new MisaInvoiceProvider(CFG).findByReference("DH-001");
    expect(r).toEqual({ state: "NOT_FOUND" });
    expect(statusMock).toHaveBeenCalledWith(["DH-001"], CFG, "refId");
  });

  it("tờ còn hiệu lực → THẤY, kèm số và mã tra cứu", async () => {
    statusMock.mockResolvedValue([statusItem()]);
    expect(await new MisaInvoiceProvider(CFG).findByReference("DH-001")).toEqual({
      state: "FOUND",
      invoiceNo: "00000131",
      transactionId: "TX1",
      issued: true,
      deleted: false,
      matches: 1,
    });
  });

  it("tờ đã bị xóa bên MISA → THẤY nhưng deleted", async () => {
    statusMock.mockResolvedValue([statusItem({ isDeleted: true })]);
    const r = await new MisaInvoiceProvider(CFG).findByReference("DH-001");
    expect(r).toMatchObject({ state: "FOUND", deleted: true });
  });

  it("nhiều tờ cùng mã → lấy tờ còn hiệu lực, báo số tờ", async () => {
    statusMock.mockResolvedValue([
      statusItem({ transactionId: "CU", isDeleted: true, invoiceNo: "00000001" }),
      statusItem({ transactionId: "MOI", invoiceNo: "00000002" }),
    ]);
    const r = await new MisaInvoiceProvider(CFG).findByReference("DH-001");
    expect(r).toMatchObject({ state: "FOUND", transactionId: "MOI", deleted: false, issued: true, matches: 2 });
  });

  it("gọi MISA lỗi → KHÔNG TRA ĐƯỢC (khác hẳn 'không thấy'), không ném", async () => {
    statusMock.mockRejectedValue(new Error("Không gọi được MISA"));
    expect(await new MisaInvoiceProvider(CFG).findByReference("DH-001")).toEqual({
      state: "LOOKUP_FAILED",
      message: "Không gọi được MISA",
      accountProblem: false,
    });
  });

  it("không tra được vì SAI TÀI KHOẢN của shop → nói rõ là lỗi tài khoản, kèm câu chỉ chỗ sửa", async () => {
    statusMock.mockRejectedValue(
      new InvoiceProviderError("MISA từ chối cấp token", { code: "UnAuthorize", subCodes: ["MisaIdError"], httpStatus: 400 })
    );
    const r = await new MisaInvoiceProvider(CFG).findByReference("DH-001");
    expect(r).toMatchObject({ state: "LOOKUP_FAILED", accountProblem: true });
    expect(r.state === "LOOKUP_FAILED" && r.message).toContain("mật khẩu meInvoice");
  });
});

describe("MISA báo trùng mã tham chiếu lúc phát hành", () => {
  const duplicate = () =>
    new InvoiceProviderError("meInvoice từ chối", { code: "DuplicateInvoiceRefID", description: "RefID bị trùng" });

  it("tờ trước còn hiệu lực → nối lại số hóa đơn, coi như phát hành xong", async () => {
    publishMock.mockRejectedValue(duplicate());
    statusMock.mockResolvedValue([statusItem()]);
    const r = await new MisaInvoiceProvider(CFG).createInvoice(INPUT);
    expect(r).toMatchObject({
      status: InvoiceLogStatus.ISSUED,
      invoiceNo: "00000131",
      transactionId: "TX1",
      vatAmount: 1_000,
    });
  });

  it("tờ trước đã bị xóa / tra không thấy / tra không được → giữ lỗi trùng, KHÔNG tự coi là xong", async () => {
    for (const lookup of [
      () => statusMock.mockResolvedValue([statusItem({ isDeleted: true })]),
      () => statusMock.mockResolvedValue([]),
      () => statusMock.mockRejectedValue(new Error("mạng")),
      () => statusMock.mockResolvedValue([statusItem({ invoiceNo: null })]),
    ]) {
      publishMock.mockReset();
      statusMock.mockReset();
      publishMock.mockRejectedValue(duplicate());
      lookup();
      const r = await new MisaInvoiceProvider(CFG).createInvoice(INPUT);
      expect(r.status).toBe(InvoiceLogStatus.FAILED);
      expect(r.errorCode).toBe("DuplicateInvoiceRefID");
    }
  });

  it("lỗi khác (không phải trùng) → không tra ngược", async () => {
    publishMock.mockRejectedValue(new InvoiceProviderError("từ chối", { code: "InvalidTaxCode" }));
    const r = await new MisaInvoiceProvider(CFG).createInvoice(INPUT);
    expect(r.status).toBe(InvoiceLogStatus.FAILED);
    expect(statusMock).not.toHaveBeenCalled();
  });
});
