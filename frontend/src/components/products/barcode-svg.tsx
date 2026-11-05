import type { CSSProperties } from "react";

import { barcodeShape } from "@/lib/barcode";

/**
 * Hình mã vạch (SVG) cho tem sản phẩm kho. Chiều ngang tính theo MÔ-ĐUN (đã gồm vùng trắng bắt
 * buộc hai bên) rồi kéo giãn theo khung chứa — khung rộng bao nhiêu vạch giãn bấy nhiêu, không
 * bao giờ cắt mất vạch. Màu đen / trắng cố định: đây là thứ in ra giấy, không theo giao diện tối.
 * Mã không vẽ được (ký tự ngoài ASCII) → trả null, nơi gọi tự in chữ thay thế.
 */
export function BarcodeSvg({ code, style, className }: { code: string; style?: CSSProperties; className?: string }) {
  const shape = barcodeShape(code);
  if (!shape) return null;
  const total = shape.quietLeft + shape.modules.length + shape.quietRight;
  // Gom các mô-đun đen liền nhau thành một hình chữ nhật (ít phần tử, mép vạch không hở khi in).
  const bars: { x: number; w: number }[] = [];
  for (let i = 0; i < shape.modules.length; ) {
    if (shape.modules[i] === "0") {
      i++;
      continue;
    }
    let j = i;
    while (j < shape.modules.length && shape.modules[j] === "1") j++;
    bars.push({ x: shape.quietLeft + i, w: j - i });
    i = j;
  }
  return (
    <svg
      viewBox={`0 0 ${total} 10`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      role="img"
      aria-label={`Mã vạch ${code}`}
      className={className}
      style={{ display: "block", background: "#fff", ...style }}
    >
      {bars.map((b) => (
        <rect key={b.x} x={b.x} y={0} width={b.w} height={10} fill="#000" />
      ))}
    </svg>
  );
}
