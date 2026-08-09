"use client";

import { useRef } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  CircleHelp,
  ExternalLink,
  Link2,
  Maximize2,
  PlugZap,
  Presentation,
  RefreshCw,
  Wallet,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TEXT_SUB } from "@/lib/typography";

/**
 * HƯỚNG DẪN SỬ DỤNG CƠ BẢN — trang tĩnh cho khách hàng mới (kế hoạch 09/08).
 *
 * Nội dung bám SÁT giao diện thật (tên nút, tên menu lấy nguyên văn từ
 * /channels, /orders, /mappings…) theo đúng 3 chặng vận hành:
 *   Ủy quyền gian hàng → Đồng bộ đơn hàng → Đối soát dòng tiền.
 * Viết cho người KHÔNG rành kỹ thuật: mỗi bước là một câu lệnh thao tác cụ
 * thể, thuật ngữ (token, đối soát…) đều có giải thích ngay tại chỗ.
 */

// Một bước thao tác trong danh sách đánh số của từng chặng.
interface Step {
  title: string;
  detail: React.ReactNode;
}

// Nhấn tên nút / tên menu xuất hiện trên giao diện thật để người đọc dò theo.
function UiName({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[13px] font-medium text-slate-800">
      {children}
    </span>
  );
}

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-4">
      {steps.map((s, i) => (
        <li key={s.title} className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
            {i + 1}
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-slate-900">{s.title}</p>
            <div className="text-sm leading-relaxed text-slate-600">
              {s.detail}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// Khối "Lưu ý" màu hổ phách nhạt — dùng cho các bẫy hay gặp trong từng chặng.
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800">
      {children}
    </div>
  );
}

const AUTHORIZE_STEPS: Step[] = [
  {
    title: "Mở trang Kênh bán",
    detail: (
      <>
        Trên thanh menu trái, chọn <UiName>Kênh bán</UiName> rồi bấm nút{" "}
        <UiName>Kết nối gian hàng</UiName> ở góc phải.
      </>
    ),
  },
  {
    title: "Chọn sàn cần kết nối",
    detail: (
      <>
        Trong hộp thoại, chọn sàn (Shopee, Lazada hoặc TikTok Shop) rồi bấm{" "}
        <UiName>Tiếp tục</UiName>. Tên gian hàng sẽ được lấy tự động từ sàn sau
        khi ủy quyền — bạn không cần nhập tay.
      </>
    ),
  },
  {
    title: "Đăng nhập và xác nhận ủy quyền trên trang của sàn",
    detail: (
      <>
        <b>Shopee / TikTok Shop:</b> trình duyệt chuyển sang trang của sàn —
        đăng nhập tài khoản người bán rồi bấm xác nhận, hệ thống sẽ tự đưa bạn
        quay về Hubsell.
        <br />
        <b>Lazada:</b> trang ủy quyền mở ở tab mới; ủy quyền xong trình duyệt
        quay về Hubsell với mã điền sẵn — bạn chỉ cần bấm{" "}
        <UiName>Đổi code lấy token</UiName> để hoàn tất.
      </>
    ),
  },
  {
    title: "Kiểm tra kết quả",
    detail: (
      <>
        Gian hàng hiện trên trang <UiName>Kênh bán</UiName> với trạng thái{" "}
        <span className="font-medium text-emerald-600">Đang hoạt động</span> là
        kết nối thành công. Một sàn có thể kết nối nhiều gian hàng — lặp lại các
        bước trên cho từng gian.
      </>
    ),
  },
];

const SYNC_STEPS: Step[] = [
  {
    title: "Không cần làm gì — hệ thống tự đồng bộ",
    detail: (
      <>
        Sau khi ủy quyền, Hubsell tự quét đơn mới của mọi gian hàng định kỳ
        khoảng 10 phút một lần, chạy cả khi bạn không mở phần mềm. Riêng Lazada
        còn nhận đơn tức thời ngay khi khách đặt.
      </>
    ),
  },
  {
    title: "Muốn lấy đơn ngay: bấm đồng bộ thủ công",
    detail: (
      <>
        Vào <UiName>Kênh bán</UiName>, bấm <UiName>Đồng bộ đơn</UiName> trên
        gian hàng cần lấy. Kết quả báo ngay số đơn mới và số đơn được cập nhật.
      </>
    ),
  },
  {
    title: "Xem và xử lý đơn",
    detail: (
      <>
        Tất cả đơn của mọi sàn nằm chung tại menu <UiName>Đơn hàng</UiName> —
        lọc được theo sàn, gian hàng, trạng thái.
      </>
    ),
  },
  {
    title: "Liên kết sản phẩm để trừ kho và tính lãi lỗ",
    detail: (
      <>
        Vào <UiName>Liên kết sản phẩm</UiName> để nối SKU trên sàn với sản phẩm
        trong kho — đơn về sẽ tự trừ tồn kho đúng sản phẩm. Sau đó nhập giá vốn
        tại <UiName>Quản lý Tài chính → Cấu hình Giá vốn</UiName> để báo cáo
        lãi/lỗ tính đúng.
      </>
    ),
  },
];

const SETTLEMENT_STEPS: Step[] = [
  {
    title: "Đối soát là gì?",
    detail: (
      <>
        Khi đơn hoàn tất, sàn quyết toán và chuyển tiền cho bạn sau khi trừ phí
        sàn, phí thanh toán, phí vận chuyển, khuyến mãi… Đối soát là bước Hubsell
        lấy bảng quyết toán đó về, để bạn biết chính xác{" "}
        <b>từng đơn thực nhận bao nhiêu tiền</b> thay vì chỉ thấy doanh thu.
      </>
    ),
  },
  {
    title: "Hệ thống tự đối soát mỗi giờ",
    detail: (
      <>
        Cũng như đơn hàng, dữ liệu quyết toán được tự động cập nhật mỗi giờ cho
        cả Shopee, Lazada và TikTok Shop. Muốn cập nhật ngay, vào{" "}
        <UiName>Kênh bán</UiName> bấm <UiName>Đồng bộ đối soát</UiName> trên
        từng gian hàng.
      </>
    ),
  },
  {
    title: "Xem kết quả đối soát",
    detail: (
      <>
        <UiName>Quản lý Tài chính → Lãi/Lỗ Thực Hiện</UiName>: lợi nhuận từng
        đơn sau khi trừ đủ phí thật của sàn.
        <br />
        <UiName>Quản lý Tài chính → Báo cáo dòng tiền</UiName>: tiền sàn đã
        chuyển về ngân hàng theo ngày.
      </>
    ),
  },
];

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Gian hàng báo “Đã ngắt kết nối” hoặc không đồng bộ được nữa?",
    a: (
      <>
        Phiên ủy quyền với sàn có thời hạn và có thể hết hạn. Vào{" "}
        <UiName>Kênh bán</UiName>, bấm <UiName>Kết nối lại</UiName> trên gian
        hàng đó và đăng nhập <b>đúng tài khoản sàn của gian này</b> để cấp lại
        quyền — đơn hàng và báo cáo cũ không mất đi đâu cả.
      </>
    ),
  },
  {
    q: "Khách vừa đặt đơn mà chưa thấy trên Hubsell?",
    a: (
      <>
        Chờ tối đa 10 phút để chu kỳ tự quét tiếp theo chạy, hoặc vào{" "}
        <UiName>Kênh bán</UiName> bấm <UiName>Đồng bộ đơn</UiName> để lấy ngay.
      </>
    ),
  },
  {
    q: "Đơn về nhưng không trừ tồn kho?",
    a: (
      <>
        Sản phẩm trên sàn chưa được nối với sản phẩm trong kho. Vào{" "}
        <UiName>Liên kết sản phẩm</UiName> để nối SKU — các đơn sau sẽ trừ kho
        tự động.
      </>
    ),
  },
  {
    q: "Báo cáo lãi/lỗ chưa thấy số hoặc số chưa đúng?",
    a: (
      <>
        Kiểm tra hai việc: (1) đã nhập giá vốn tại{" "}
        <UiName>Cấu hình Giá vốn</UiName> chưa; (2) đơn đã được sàn quyết toán
        chưa — phí thật chỉ có sau khi đơn hoàn tất và sàn trả bảng đối soát
        (thường vài ngày sau khi giao thành công).
      </>
    ),
  },
  {
    q: "Ai trong shop được thao tác các bước này?",
    a: (
      <>
        Kết nối gian hàng, đồng bộ và xem báo cáo tài chính là quyền của{" "}
        <b>Chủ shop (Quản trị)</b>. Tài khoản Nhân viên bán hàng / Thủ kho chỉ
        thấy các phần việc của mình.
      </>
    ),
  },
];

// Ba chặng chính — dùng cho dải tổng quan đầu trang và tiêu đề từng khối.
const SECTIONS = [
  {
    id: "uy-quyen",
    icon: PlugZap,
    label: "Ủy quyền gian hàng",
    hint: "Kết nối shop Shopee / Lazada / TikTok vào Hubsell",
  },
  {
    id: "dong-bo",
    icon: RefreshCw,
    label: "Đồng bộ đơn hàng",
    hint: "Đơn mọi sàn tự chảy về một màn hình",
  },
  {
    id: "doi-soat",
    icon: Wallet,
    label: "Đối soát dòng tiền",
    hint: "Biết từng đơn thực nhận bao nhiêu",
  },
] as const;

export default function GuidePage() {
  // Tham chiếu iframe slide để bấm "Toàn màn hình" phóng đúng khung trình chiếu
  const frameRef = useRef<HTMLIFrameElement>(null);

  return (
    <AppShell>
      <div className="space-y-6">
        {/* ===== BẢN TRÌNH CHIẾU NHÚNG — khách mở trang là xem slide luôn =====
            Deck là file tĩnh trong public/ (cùng origin) nên nhúng iframe thẳng;
            stage 16:9 của deck tự co theo kích thước iframe. Rộng hơn khối text
            (max-w-5xl so với 3xl) để slide đủ lớn mà không cần toàn màn hình. */}
        <Card className="mx-auto max-w-5xl overflow-hidden py-0 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-2.5">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Presentation className="size-4 text-slate-500" />
              Bản trình chiếu — 8 slide
              <span className={TEXT_SUB}>(phím ← → hoặc lăn chuột để chuyển)</span>
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => frameRef.current?.requestFullscreen()}
              >
                <Maximize2 className="size-3.5" />
                Toàn màn hình
              </Button>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={
                  <a
                    href="/huong-dan-hubsell.html"
                    target="_blank"
                    rel="noopener"
                  />
                }
              >
                <ExternalLink className="size-3.5" />
                Mở tab mới
              </Button>
            </div>
          </div>
          <iframe
            ref={frameRef}
            src="/huong-dan-hubsell.html"
            title="Slide hướng dẫn sử dụng Hubsell"
            className="aspect-video w-full border-0"
            allowFullScreen
          />
        </Card>

        <div className="mx-auto max-w-3xl space-y-6">
        {/* ===== MỞ ĐẦU: 3 chặng vận hành ===== */}
        <Card className="shadow-sm">
          <CardContent className="space-y-5 pt-6">
            <div className="flex items-start gap-3">
              <BookOpenText className="mt-0.5 size-5 shrink-0 text-slate-500" />
              <p className="min-w-0 flex-1 text-sm leading-relaxed text-slate-600">
                Hubsell vận hành theo 3 chặng: kết nối gian hàng một lần, sau
                đó đơn hàng và tiền quyết toán tự chảy về. Bản chi tiết dưới
                đây để tra cứu từng bước khi thao tác.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {SECTIONS.map((s, i) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="group rounded-xl border border-slate-200 p-4 transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                  <div className="flex items-center gap-2">
                    <s.icon className="size-4 text-slate-500" />
                    <span className={TEXT_SUB}>Chặng {i + 1}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {s.label}
                  </p>
                  <p className={`${TEXT_SUB} mt-1 leading-snug`}>{s.hint}</p>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500 group-hover:text-slate-800">
                    Xem hướng dẫn <ArrowRight className="size-3" />
                  </span>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ===== CHẶNG 1: ỦY QUYỀN ===== */}
        <Card id="uy-quyen" className="scroll-mt-20 shadow-sm">
          <CardHeader className="border-b pb-3">
            <CardTitle className="flex items-center gap-2">
              <PlugZap className="size-5 text-slate-500" />
              Chặng 1 — Ủy quyền gian hàng
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            <p className="text-sm leading-relaxed text-slate-600">
              Ủy quyền là bước bạn cho phép Hubsell đọc dữ liệu gian hàng (đơn
              hàng, sản phẩm, quyết toán) qua cổng chính thức của sàn. Hubsell{" "}
              <b>không hỏi và không lưu mật khẩu</b> — bạn đăng nhập trực tiếp
              trên trang của sàn.
            </p>
            <StepList steps={AUTHORIZE_STEPS} />
            <Note>
              Nếu có nhiều gian hàng, hãy đăng nhập <b>đúng tài khoản sàn của
              gian đang kết nối</b>. Đăng nhập nhầm tài khoản khác, hệ thống sẽ
              báo lỗi và không ghi đè gian cũ.
            </Note>
          </CardContent>
        </Card>

        {/* ===== CHẶNG 2: ĐỒNG BỘ ĐƠN ===== */}
        <Card id="dong-bo" className="scroll-mt-20 shadow-sm">
          <CardHeader className="border-b pb-3">
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="size-5 text-slate-500" />
              Chặng 2 — Đồng bộ đơn hàng
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            <StepList steps={SYNC_STEPS} />
            <Note>
              Nên hoàn thành <b>Liên kết sản phẩm</b> ngay sau khi kết nối gian
              hàng — đây là điều kiện để trừ tồn kho tự động và tính lãi/lỗ
              chính xác.
            </Note>
          </CardContent>
        </Card>

        {/* ===== CHẶNG 3: ĐỐI SOÁT ===== */}
        <Card id="doi-soat" className="scroll-mt-20 shadow-sm">
          <CardHeader className="border-b pb-3">
            <CardTitle className="flex items-center gap-2">
              <Wallet className="size-5 text-slate-500" />
              Chặng 3 — Đối soát dòng tiền
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            <StepList steps={SETTLEMENT_STEPS} />
          </CardContent>
        </Card>

        {/* ===== CÂU HỎI THƯỜNG GẶP ===== */}
        <Card className="shadow-sm">
          <CardHeader className="border-b pb-3">
            <CardTitle className="flex items-center gap-2">
              <CircleHelp className="size-5 text-slate-500" />
              Câu hỏi thường gặp
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y pt-2">
            {FAQ.map((f) => (
              <div key={f.q} className="space-y-1.5 py-4 first:pt-2 last:pb-2">
                <p className="text-sm font-semibold text-slate-900">{f.q}</p>
                <p className="text-sm leading-relaxed text-slate-600">{f.a}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Lối tắt sang trang thao tác đầu tiên của người mới */}
        <div className="flex items-center justify-center gap-2 pb-2">
          <Link2 className="size-4 text-slate-400" />
          <p className="text-sm text-slate-500">
            Sẵn sàng bắt đầu?{" "}
            <Link
              href="/channels"
              className="font-medium text-slate-800 underline underline-offset-4 hover:text-slate-900"
            >
              Kết nối gian hàng đầu tiên
            </Link>
          </p>
        </div>
        </div>
      </div>
    </AppShell>
  );
}
