"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";

/** "52000" → "52.000" (dấu chấm phân tách hàng nghìn kiểu Việt Nam) */
export function formatThousands(digits: string): string {
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Giữ lại đúng chữ số, bỏ mọi dấu chấm/phẩy/khoảng trắng người dùng gõ vào */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Ô nhập tiền tự chèn dấu phân tách hàng nghìn ngay khi gõ.
 *
 * Vì sao không dùng <input type="number">?
 *  1. type="number" KHÔNG hiển thị được dấu phân tách — gõ 52000 vẫn ra 52000,
 *     rất dễ nhìn nhầm thành 5.200 hay 520.000 khi nhập giá vốn.
 *  2. type="number" có mũi tên tăng/giảm và phản ứng với LĂN CHUỘT: ô đang
 *     focus mà cuộn trang là số tự đổi rồi bị lưu tự động — từng làm hỏng dữ
 *     liệu giá vốn thật. Dùng type="text" + inputMode="numeric" thì bàn phím
 *     số trên điện thoại vẫn hiện, mà không còn cái bẫy lăn chuột nào.
 *
 * `value` và `onValueChange` làm việc với CHUỖI CHỮ SỐ THÔ ("52000"), phần
 * hiển thị có dấu chấm chỉ là lớp áo — nơi gọi không phải tự bóc dấu.
 */
export function CurrencyInput({
  value,
  onValueChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (digits: string) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Vị trí con trỏ cần khôi phục sau khi chuỗi được định dạng lại
  const caretRef = React.useRef<number | null>(null);

  const display = formatThousands(onlyDigits(value ?? ""));

  React.useLayoutEffect(() => {
    if (caretRef.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(caretRef.current, caretRef.current);
      caretRef.current = null;
    }
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const el = e.target;
    // Đếm số CHỮ SỐ đứng trước con trỏ, không đếm ký tự — vì việc chèn thêm
    // dấu chấm sẽ làm lệch vị trí nếu tính theo ký tự. Nhờ vậy sửa giữa chuỗi
    // (ví dụ thêm số 0 vào giữa) con trỏ vẫn nằm đúng chỗ.
    const digitsBeforeCaret = onlyDigits(
      el.value.slice(0, el.selectionStart ?? el.value.length)
    ).length;

    const digits = onlyDigits(el.value);
    const formatted = formatThousands(digits);

    let pos = 0;
    let seen = 0;
    while (pos < formatted.length && seen < digitsBeforeCaret) {
      if (/\d/.test(formatted[pos])) seen++;
      pos++;
    }
    caretRef.current = pos;

    onValueChange(digits);
  }

  return (
    <Input
      {...props}
      ref={inputRef}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={display}
      onChange={handleChange}
    />
  );
}
