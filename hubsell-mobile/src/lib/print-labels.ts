import { Platform } from "react-native";

// ============================================================
// IN TỆP VẬN ĐƠN TRÊN ĐIỆN THOẠI (19/11/2026, docs/MOBILE-CHUAN-BI-HANG-IN-PHIEU.md mục 4)
//
// Máy chủ trả MỘT tệp PDF khổ A6 (vận đơn chính chủ của sàn, đã chèn thông tin shop nếu
// bật). App không tự nói chuyện với máy in — có hai lối ra, cả hai dùng đúng tệp đó:
//   1. MỞ BẰNG APP MÁY IN (lối chính, anh Trung chốt 19/11): bảng chia sẻ của máy → app của
//      hãng máy in (máy in nhiệt Bluetooth đa số in qua app riêng của hãng), hoặc lưu tệp /
//      gửi sang máy tính. ShipXanh, BigSeller, app TikTok Shop đều in kiểu này.
//   2. IN QUA WI-FI: hộp in của hệ điều hành (iPhone: AirPrint · Android: dịch vụ in của máy
//      / của hãng máy in). Dùng cho máy in nối Wi-Fi / LAN mà điện thoại thấy được.
// ⛔ Hubsell KHÔNG tự nối Bluetooth / LAN tới máy in và KHÔNG làm chọn khổ giấy — khổ A6 / A7
//    khách cài trong app máy in (anh Trung: "việc gì mình phải gánh phần này").
//
// Ba module native (expo-print, expo-sharing, expo-file-system) chỉ có từ bản dựng 1.5.0.
// Mã JS này có thể tới bản cũ qua OTA nên nạp module bằng require trong try/catch: bản
// thiếu module thì `printSupport()` báo không in được, màn hình ẩn nút — không văng app.
// ============================================================

export interface PrintSupport {
  /** Mở được hộp in của hệ điều hành. */
  print: boolean;
  /** Mở được bảng chia sẻ tệp. */
  share: boolean;
}

type PrintModule = typeof import("expo-print");
type SharingModule = typeof import("expo-sharing");
type FileSystemModule = typeof import("expo-file-system");

let nativeCache: { print: PrintModule | null; sharing: SharingModule | null; fs: FileSystemModule | null } | null =
  null;

function native() {
  if (nativeCache) return nativeCache;
  const load = <T,>(fn: () => T): T | null => {
    try {
      return fn();
    } catch {
      return null;
    }
  };
  nativeCache = {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    print: load(() => require("expo-print") as PrintModule),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sharing: load(() => require("expo-sharing") as SharingModule),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fs: load(() => require("expo-file-system") as FileSystemModule),
  };
  return nativeCache;
}

export function printSupport(): PrintSupport {
  if (Platform.OS === "web") {
    // Giả lập web: lối "app máy in" = tải tệp về, đủ để soi hai nút và luồng hỏi "đã in xong".
    const dom = typeof document !== "undefined";
    return { print: dom, share: dom };
  }
  const n = native();
  // In và chia sẻ đều cần ghi tệp ra bộ nhớ đệm trước.
  return { print: Boolean(n.print && n.fs), share: Boolean(n.sharing && n.fs) };
}

/** Thư mục tệp vận đơn tạm trong bộ nhớ đệm của app. */
const LABEL_DIR = "van-don";
/** Tệp cũ hơn mốc này bị xóa mỗi lần in — vận đơn có tên, địa chỉ khách, không để lại máy. */
const KEEP_MS = 60 * 60 * 1000;

/** Ghi tệp PDF vào bộ nhớ đệm của app, trả đường dẫn; tiện tay dọn tệp vận đơn cũ. */
function writeToCache(bytes: Uint8Array, fileName: string): string {
  const fs = native().fs;
  if (!fs) throw new Error("Bản app này chưa hỗ trợ in — hãy cập nhật app");
  const dir = new fs.Directory(fs.Paths.cache, LABEL_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  const cutoff = Date.now() - KEEP_MS;
  for (const item of dir.list()) {
    try {
      if (item instanceof fs.File && (item.modificationTime ?? 0) < cutoff) item.delete();
    } catch {
      // tệp đang mở ở app khác — lần sau dọn
    }
  }
  const file = new fs.File(dir, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return file.uri;
}

const WEB_FRAME_ID = "hubsell-print-frame";

/** Giả lập web: in tệp PDF bằng iframe ẩn như bản web của Hubsell. */
function printOnWeb(bytes: Uint8Array): boolean {
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  if (/firefox/i.test(navigator.userAgent)) return Boolean(window.open(url, "_blank"));
  document.getElementById(WEB_FRAME_ID)?.remove();
  const iframe = document.createElement("iframe");
  iframe.id = WEB_FRAME_ID;
  iframe.title = "In phiếu";
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  iframe.src = url;
  iframe.onload = () => {
    window.setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        window.open(url, "_blank");
      }
    }, 400);
  };
  document.body.appendChild(iframe);
  return true;
}

/**
 * Mở hộp in của hệ điều hành cho tệp PDF.
 *   "opened"    — hộp in đã mở (iPhone: lệnh in đã bắt đầu; Android / web: hộp in đã hiện,
 *                 hệ điều hành không báo người dùng có bấm In hay không).
 *   "cancelled" — iPhone: người dùng đóng hộp in mà không in.
 * Ném lỗi khi không mở được hộp in.
 */
export async function printPdf(bytes: Uint8Array, fileName: string): Promise<"opened" | "cancelled"> {
  if (Platform.OS === "web") {
    if (!printOnWeb(bytes)) throw new Error("Trình duyệt đã chặn cửa sổ in");
    return "opened";
  }
  const print = native().print;
  if (!print) throw new Error("Bản app này chưa hỗ trợ in — hãy cập nhật app");
  const uri = writeToCache(bytes, fileName);
  try {
    await print.printAsync({ uri });
    return "opened";
  } catch (err) {
    // iPhone: đóng hộp in mà không in → expo-print từ chối promise ("did not complete").
    const msg = err instanceof Error ? err.message : String(err);
    if (Platform.OS === "ios" && /not complete|cancel/i.test(msg)) return "cancelled";
    throw err;
  }
}

/**
 * Mở bảng chia sẻ của máy cho tệp PDF (đưa sang app của hãng máy in, lưu tệp, gửi máy
 * tính…). Hệ điều hành không cho biết người dùng đã chia sẻ hay đóng bảng.
 */
export async function sharePdf(bytes: Uint8Array, fileName: string): Promise<void> {
  if (Platform.OS === "web") {
    // Giả lập web không có bảng chia sẻ sang app máy in → tải tệp về máy.
    const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  const sharing = native().sharing;
  if (!sharing) throw new Error("Bản app này chưa hỗ trợ mở tệp bằng app khác — hãy cập nhật app");
  const uri = writeToCache(bytes, fileName);
  await sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
    dialogTitle: "Mở tệp vận đơn bằng",
  });
}

/** Tên tệp vận đơn: ngắn, không dấu, không lộ gì về shop. */
export function labelFileName(orderCount: number, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `van-don-${orderCount}-don-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.pdf`;
}
