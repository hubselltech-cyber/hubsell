"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleDollarSign } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getStoredUser, type MissingCostSummary } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { can } from "@/lib/permissions";

/**
 * Khách bấm "Bỏ qua" (hoặc X / Esc) = KHÔNG HIỆN LẠI NỮA (anh Trung 02/10/2026:
 * "khách bỏ qua thường là họ biết rồi và cũng không muốn hiện lại, đừng làm họ
 * khó chịu"). Nhớ theo tài khoản trên trình duyệt này, cùng kiểu các dải nhắc
 * khác của app. Dòng "N đơn chưa có giá vốn" trên trang vẫn còn để ai cần thì bấm.
 */
const DISMISS_PREFIX = "hubsell_missing_cost_prompt_dismissed:";
/** Đã bấm "Nhập giá vốn" trong lượt làm việc này → quay lại trang không hỏi nữa. */
const SESSION_KEY = "hubsell_missing_cost_prompt_done";

function isQuiet(): boolean {
  try {
    return (
      sessionStorage.getItem(SESSION_KEY) === "1" ||
      localStorage.getItem(DISMISS_PREFIX + (getStoredUser()?.id ?? "")) === "1"
    );
  } catch {
    return false;
  }
}

/**
 * HỘP NHẮC NHẬP GIÁ VỐN ở Tổng quan và Báo cáo dòng tiền (anh Trung 02/10/2026):
 * khách nối gian xong thường về hai trang này xem lãi — đúng lúc đơn đã về và
 * con số lợi nhuận đang thiếu những đơn chưa có giá vốn. Điều kiện hiện = chính
 * số `missingCost` trang đang hiển thị (kỳ + gian đang lọc), nên hộp và trang
 * không bao giờ nói hai con số khác nhau. Mỗi lần vào trang hỏi tối đa một lần;
 * chỉ người có quyền Cấu hình Giá vốn mới thấy.
 */
export function MissingCostPrompt({ summary }: { summary?: MissingCostSummary }) {
  const router = useRouter();
  const count = summary?.orderCount ?? 0;
  const [open, setOpen] = useState(false);
  // Số đơn lúc bật hộp — giữ nguyên trong hộp dù trang tính lại ở nền.
  const [shownCount, setShownCount] = useState(0);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current || count <= 0) return;
    if (!can(getStoredUser(), "finance.cost-prices") || isQuiet()) return;
    asked.current = true;
    setShownCount(count);
    setOpen(true);
  }, [count]);

  function dismissForGood() {
    try {
      localStorage.setItem(DISMISS_PREFIX + (getStoredUser()?.id ?? ""), "1");
    } catch {
      // chế độ riêng tư chặn storage — lần vào trang sau hộp lại hiện, chấp nhận
    }
    setOpen(false);
  }

  function goToCostPrices() {
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // như trên
    }
    setOpen(false);
    router.push("/finance/cost-prices");
  }

  return (
    <Dialog
      open={open}
      // Bỏ qua là bỏ hẳn, nên chỉ nhận thao tác CÓ CHỦ Ý (nút, X, Esc) — lỡ tay
      // chạm ra ngoài hộp không được tính là bỏ qua.
      disablePointerDismissal
      onOpenChange={(o) => {
        if (!o) dismissForGood();
      }}
    >
      <DialogContent className="gap-5 p-5 sm:max-w-md">
        <div className="flex items-start gap-3 pr-7">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <CircleDollarSign className="size-5" />
          </span>
          <DialogHeader className="min-w-0 gap-1.5">
            <DialogTitle className="leading-snug font-semibold">
              <span className="tabular-nums">{formatNumber(shownCount)}</span> đơn chưa
              có giá vốn
            </DialogTitle>
            <DialogDescription>
              Lợi nhuận của kỳ đang xem chưa tính các đơn này.{" "}
              <span className="font-medium text-foreground">Nhập giá vốn sản phẩm</span>{" "}
              để Hubsell tính đúng lãi/lỗ từng đơn.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Điện thoại: hai nút xếp dọc đủ cao để bấm bằng ngón tay, nút chính nằm
            trên; từ sm: một hàng canh phải như các hộp khác của app. */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="h-10 sm:h-8"
            onClick={dismissForGood}
          >
            Bỏ qua
          </Button>
          <Button type="button" className="h-10 sm:h-8" onClick={goToCostPrices}>
            Nhập giá vốn
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
