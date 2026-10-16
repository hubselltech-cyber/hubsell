"use client";

// ============================================================
// THÔNG BÁO ỨNG DỤNG DI ĐỘNG — dải mỏng dưới header, mọi trang.
//
// Bối cảnh (anh Trung 25/09/2026): seller đã bắt đầu đăng ký dùng Hubsell,
// landing + bảng giá hứa "ứng dụng di động cho chủ shop & kho" nhưng app
// đang ở bước đăng ký tài khoản nhà phát triển Apple / Google (docs/
// DUA-APP-LEN-CH-PLAY-APP-STORE.md), dự kiến ra mắt tháng 10/2026. Khách mới
// tìm app không thấy sẽ nghĩ bị hứa suông → dải này nói RÕ khi nào có, làm
// được gì, tài khoản hiện tại dùng ra sao, để khách yên tâm ở lại.
//
// Chủ đích:
// - Thông tin, KHÔNG phải cảnh báo → tông xanh dịu, không icon tam giác.
// - Một ô tích "Không hiện lại" ngay trên dải (anh Trung: dấu tích để khách
//   tắt) + trong hộp chi tiết; lưu localStorage theo NOTICE_VERSION — đổi
//   nội dung lớn (app đã lên kho, đổi mốc) thì tăng version, khách thấy lại.
// - Tự tắt sau NOTICE_UNTIL để câu "sắp ra mắt" không bao giờ đứng lì khi
//   lỡ quên gỡ; khi app lên kho thật thì thay bằng dải "đã có mặt" + link tải.
// - Hiện cho MỌI tài khoản shop (chủ + nhân viên kho đều có phần trong app),
//   trừ khu HQ; không gọi API — thuần tĩnh.
// - Mọi tính năng kể trong hộp chi tiết chép từ màn hình THẬT của
//   hubsell-mobile (home 3 tab, orders, messages, assistant, warehouse/scan),
//   không hứa thứ app chưa có (không có chuông đẩy — app chưa cài
//   expo-notifications).
// ============================================================

import { useState } from "react";
import { ScanLine, Smartphone, Wallet } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// 14/10/2026 — BẢN "ĐÃ CÓ MẶT": Android phát hành trên Google Play 13/10
// (vn.hubsell.app). 16/10/2026 — Apple duyệt + phát hành App Store (Apple ID
// 6819512670) → điền APP_STORE_URL, tăng NOTICE_VERSION lần nữa để khách đã
// tắt bản "iPhone đang chờ" thấy dải đủ 2 kho.
//
// 14/10/2026 tối — NÚT TẢI = MÃ QR (anh Trung): khách đang ngồi máy tính dùng
// phần mềm, bấm nút trên dải ra ngay hộp có mã QR, giơ điện thoại quét là
// xong — không phải tự gõ link Google Play trên máy. QR là SVG tĩnh
// public/qr/tai-app.svg (bản sao đúng của landing, đã giải mã kiểm tra = URL
// https://hubsell.vn/tai-app); trang đó nhìn hệ máy: Android chuyển thẳng
// Google Play, iPhone chuyển App Store khi có link. Nội dung QR cố định nên
// Apple duyệt xong KHÔNG phải sinh lại. Nếu khách đang mở phần mềm ngay trên
// điện thoại thì quét QR vô nghĩa → nút dẫn thẳng tới kho ứng dụng của máy.

/** Đổi khi nội dung thay đổi lớn → khách đã tắt bản cũ sẽ thấy bản mới. */
const NOTICE_VERSION = "live-ios-2026-10";
/** Sau mốc này dải tự biến mất dù chưa ai gỡ code (an toàn khi lỡ quên). */
const NOTICE_UNTIL = new Date("2027-01-15T00:00:00+07:00");
const DISMISS_KEY = "hubsell_mobile_app_notice_dismissed";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=vn.hubsell.app";
/** App Store từ 16/10/2026; giữ kiểu string | null để mọi nhánh render vẫn tự xử lý nếu phải gỡ link. */
const APP_STORE_URL: string | null = "https://apps.apple.com/vn/app/id6819512670";
/** Mã QR tĩnh — nội dung https://hubsell.vn/tai-app (trang tự đưa tới đúng kho ứng dụng). */
const QR_SRC = "/qr/tai-app.svg";
const QR_TARGET = "https://hubsell.vn/tai-app";

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DISMISS_KEY) === NOTICE_VERSION;
  } catch {
    return false;
  }
}

function writeDismissed(on: boolean) {
  try {
    if (on) localStorage.setItem(DISMISS_KEY, NOTICE_VERSION);
    else localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* chế độ riêng tư chặn storage — coi như chưa tắt */
  }
}

/**
 * Khách đang mở phần mềm trên chính điện thoại → không cần QR, dẫn thẳng kho
 * ứng dụng của máy. Trả null khi là máy tính (hoặc iPhone mà App Store chưa
 * có link → vẫn mở hộp QR để đọc "sắp có").
 */
function directStoreUrl(): string | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return PLAY_STORE_URL;
  if (/iphone|ipad|ipod/i.test(ua)) return APP_STORE_URL;
  return null;
}

const OWNER_FEATURES = [
  "Kết quả hôm nay: doanh thu, lợi nhuận ròng, tiền đã về ngân hàng — cùng con số với bản web.",
  "Đơn hàng của mọi sàn theo trạng thái, lọc riêng đơn hỏa tốc, quét mã đơn bằng camera mở ngay chi tiết.",
  "Quảng cáo đang chạy của các gian đã nối: tạm dừng hoặc bật lại ngay trên máy.",
  "Hỏi Trợ lý Hubsell bằng tiếng Việt tự nhiên, gõ hoặc nói, nhận số liệu thật của shop.",
];

const WAREHOUSE_FEATURES = [
  "Quét mã vận đơn bằng camera để nhận hàng hoàn, không cần máy quét rời.",
  "Thấy ngay kiện chờ về kho, kiện quá hạn, hàng hỏng chờ khiếu nại.",
];

const ACCOUNT_NOTES = [
  "Đăng nhập bằng đúng email và mật khẩu đang dùng, không cần đăng ký lại.",
  "Phân quyền nhân viên giữ nguyên: chủ shop thấy tài chính, nhân viên kho thấy màn quét.",
  "Có sẵn trong mọi gói dịch vụ, không thu thêm phí.",
  "Có trên Google Play từ 13/10/2026 và App Store từ 16/10/2026.",
];

/** Hai nút kho ứng dụng — dùng chung cho hộp QR và hộp chi tiết. */
function StoreButtons({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <a
        href={PLAY_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants()}
      >
        Android · Google Play
      </a>
      {APP_STORE_URL ? (
        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline" })}
        >
          iPhone · App Store
        </a>
      ) : (
        <Button variant="outline" disabled>
          iPhone · App Store sắp có
        </Button>
      )}
    </div>
  );
}

/** Ảnh mã QR trong khung trắng (nền trắng cố định để máy quét đọc được cả ở giao diện tối). */
function QrImage({ size }: { size: number }) {
  return (
    <div className="shrink-0 rounded-2xl border border-sky-200 bg-white p-3 shadow-sm dark:border-sky-800">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={QR_SRC}
        alt={`Mã QR mở ${QR_TARGET} để tải ứng dụng Hubsell`}
        width={size}
        height={size}
        style={{ width: size, height: size }}
      />
    </div>
  );
}

export function MobileAppLaunchNotice() {
  const [dismissed, setDismissed] = useState<boolean>(readDismissed);
  // Mốc hết hạn tính MỘT lần lúc mount (lint react-hooks/purity cấm Date.now()
  // ngay trong thân render) — dải mở cả ngày cũng không cần tự biến mất giữa chừng.
  const [expired] = useState(() => Date.now() >= NOTICE_UNTIL.getTime());
  const [open, setOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  if (dismissed || expired) return null;

  function toggleDismiss(on: boolean) {
    writeDismissed(on);
    setDismissed(on);
    if (on) {
      setOpen(false);
      setQrOpen(false);
    }
  }

  /** Bấm nút tải trên dải: điện thoại → kho ứng dụng luôn; máy tính → hộp QR. */
  function onDownloadClick() {
    const direct = directStoreUrl();
    if (direct) {
      window.open(direct, "_blank", "noopener,noreferrer");
      return;
    }
    setQrOpen(true);
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900 md:px-6 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-100">
        <Smartphone className="size-4 shrink-0" />
        <p className="min-w-0 flex-1 truncate">
          <span className="font-semibold">
            Ứng dụng Hubsell đã có trên Google Play và App Store
          </span>
          <span className="hidden lg:inline">
            {" "}
            — dùng chung tài khoản này, không thêm phí.
          </span>
        </p>
        <button
          type="button"
          onClick={onDownloadClick}
          className="shrink-0 rounded-md bg-sky-600 px-2.5 py-1 font-medium text-white transition-colors hover:bg-sky-700"
        >
          <span className="sm:hidden">Tải app</span>
          <span className="hidden sm:inline">Quét mã tải app</span>
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-md border border-sky-300 bg-card px-2.5 py-1 font-medium transition-colors hover:bg-sky-100 dark:border-sky-800 dark:hover:bg-sky-900/40"
        >
          Xem chi tiết
        </button>
        {/* Dấu tích tắt — anh Trung 25/09: khách tự tắt bằng ô tích, không
            phải nút X mờ dễ bấm nhầm. */}
        <label className="hidden shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap sm:flex">
          <input
            type="checkbox"
            className="size-4 accent-sky-600"
            checked={false}
            onChange={() => toggleDismiss(true)}
            aria-label="Không hiện thông báo ứng dụng di động nữa"
          />
          Không hiện lại
        </label>
      </div>

      {/* HỘP MÃ QR — một việc duy nhất: giơ điện thoại lên quét. */}
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="size-5 text-sky-600" />
              Quét mã để tải ứng dụng Hubsell
            </DialogTitle>
            <DialogDescription>
              Mở camera điện thoại, hướng vào mã bên dưới — máy tự mở đúng kho
              ứng dụng: Android vào Google Play, iPhone vào App Store.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-2">
            <QrImage size={208} />
            <p className="text-center text-xs text-muted-foreground">
              Đăng nhập bằng đúng tài khoản đang dùng, không thu thêm phí.
            </p>
            {/* Đang cầm điện thoại mở hộp này (iPhone chưa có link) thì bấm nút thay vì quét. */}
            <StoreButtons className="justify-center" />
          </div>

          <DialogFooter className="items-center gap-3 sm:justify-between">
            <button
              type="button"
              onClick={() => {
                setQrOpen(false);
                setOpen(true);
              }}
              className="text-sm text-sky-700 underline-offset-4 hover:underline dark:text-sky-300"
            >
              Ứng dụng làm được gì?
            </button>
            <Button variant="outline" onClick={() => setQrOpen(false)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="size-5 text-sky-600" />
              Ứng dụng Hubsell trên điện thoại
            </DialogTitle>
            <DialogDescription>
              Bản Android có trên <b>Google Play</b> từ 13/10/2026.
              {APP_STORE_URL
                ? " Bản iPhone có trên App Store từ 16/10/2026."
                : " Bản iPhone đang chờ Apple duyệt, lên App Store ngay khi được duyệt."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 text-sm">
            <section className="flex items-center gap-4 rounded-lg border border-sky-200 bg-sky-50/60 p-3.5 dark:border-sky-900/50 dark:bg-sky-950/30">
              <QrImage size={112} />
              <div className="min-w-0 space-y-2">
                <p className="font-semibold">Quét mã bằng camera điện thoại để tải</p>
                <p className="text-muted-foreground">
                  Máy tự mở đúng kho ứng dụng của hệ máy đang dùng.
                </p>
                <StoreButtons />
              </div>
            </section>

            <section>
              <h3 className="flex items-center gap-2 font-semibold">
                <Wallet className="size-4 text-emerald-600" />
                Chủ shop
              </h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
                {OWNER_FEATURES.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className="flex items-center gap-2 font-semibold">
                <ScanLine className="size-4 text-emerald-600" />
                Nhân viên kho
              </h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
                {WAREHOUSE_FEATURES.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </section>

            <section className="rounded-lg border border-sky-200 bg-sky-50/60 p-3.5 dark:border-sky-900/50 dark:bg-sky-950/30">
              <h3 className="font-semibold">Với tài khoản của bạn</h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
                {ACCOUNT_NOTES.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </section>
          </div>

          <DialogFooter className="items-center gap-3 sm:justify-between">
            <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-sky-600"
                checked={false}
                onChange={() => toggleDismiss(true)}
              />
              Không hiện thông báo này nữa
            </label>
            <Button onClick={() => setOpen(false)}>Đóng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
