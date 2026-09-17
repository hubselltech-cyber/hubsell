"use client";

// ============================================================
// TRANG CALLBACK ỦY QUYỀN TIKTOK ADS (TikTok Marketing API)
//
// TikTok for Business chuyển về đây kèm ?auth_code=...&state=... sau khi người
// giữ tài khoản quảng cáo bấm Confirm. Trang gửi mã lên backend (route CÔNG
// KHAI — danh tính chủ shop nằm trong state đã ký) → backend tự dò gian.
//
// Người bấm có thể KHÔNG phải chủ shop (người chạy quảng cáo thuê mở link chủ
// shop gửi) nên trang không đòi đăng nhập Hubsell; khi đó chỉ báo kết quả,
// không dẫn vào app.
//
// Dev local: Redirect URL đăng ký trên portal là domain production → state do
// backend local ký mang `fe` = localhost; trang production thấy vậy thì bật
// nguyên query về localhost (chỉ chấp nhận localhost — chặn open-redirect).
// ============================================================

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError, connectTiktokAds, type TiktokAdsConnectResult } from "@/lib/api";

type Phase = "processing" | "success" | "error";

/** Origin FE local trong state (đọc KHÔNG kiểm chữ ký — chỉ để chuyển tiếp về localhost). */
function devOriginOf(state: string): string | null {
  try {
    const payload = JSON.parse(atob(state.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
      fe?: unknown;
    };
    const fe = typeof payload.fe === "string" ? payload.fe : "";
    return /^https?:\/\/localhost(:\d+)?$/.test(fe) ? fe : null;
  } catch {
    return null;
  }
}

export default function TiktokAdsCallbackPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("processing");
  const [message, setMessage] = useState("Đang kết nối tài khoản quảng cáo TikTok…");
  const [result, setResult] = useState<TiktokAdsConnectResult | null>(null);
  // Lỗi "nhầm tài khoản TikTok": trang ủy quyền của TikTok tự điền tài khoản đang
  // đăng nhập trên trình duyệt, Hubsell không ép chọn lại được (URL chỉ nhận
  // app_id/state/redirect_uri) → chỉ cách đổi tài khoản NGAY TẠI màn báo lỗi.
  const [wrongAccount, setWrongAccount] = useState(false);
  // auth_code chỉ dùng được MỘT LẦN — StrictMode gọi effect 2 lượt ở dev.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const authCode = params.get("auth_code") ?? params.get("code");
    const state = params.get("state") ?? "";

    if (!authCode || !state) {
      setPhase("error");
      setMessage("Không nhận được mã ủy quyền từ TikTok. Hãy bấm Kết nối lại từ Hubsell.");
      return;
    }

    const devOrigin = devOriginOf(state);
    if (devOrigin && devOrigin !== window.location.origin) {
      window.location.replace(`${devOrigin}/ads/tiktok/callback${window.location.search}`);
      return;
    }

    connectTiktokAds(authCode, state)
      .then((r) => {
        setResult(r);
        setPhase("success");
        // Kết quả nói về ĐÚNG gian chủ shop bấm nút (mỗi gian có thể một tài khoản quảng cáo riêng).
        setMessage(
          r.target && !r.target.linked
            ? `Gian ${r.target.shopName} chưa kết nối được: ${r.target.reason ?? "tài khoản vừa ủy quyền không chạy quảng cáo cho gian này."}`
            : r.linked.length === 1
              ? `Đã kết nối quảng cáo cho gian ${r.linked[0].shopName}.`
              : `Đã kết nối quảng cáo cho ${r.linked.length} gian TikTok.`
        );
      })
      .catch((err) => {
        setPhase("error");
        const msg = err instanceof ApiError ? err.message : "Không kết nối được máy chủ Hubsell.";
        setMessage(msg);
        // Chỉ hai lý do "nhầm tài khoản" mới chứa cụm này; gian chưa cấp quyền GMV Max cho ai thì đổi tài khoản cũng vô ích.
        setWrongAccount(/vừa ủy quyền/.test(msg));
      });
  }, []);

  const isInvite = result?.kind === "invite";
  const targetMissed = result?.target != null && !result.target.linked;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          {phase === "processing" && (
            <>
              <Loader2 className="size-10 animate-spin text-slate-400" />
              <p className="text-slate-600">{message}</p>
            </>
          )}

          {phase === "success" && result && (
            <>
              {targetMissed ? (
                <XCircle className="size-12 text-amber-500" />
              ) : (
                <CheckCircle2 className="size-12 text-emerald-500" />
              )}
              <div className="space-y-1">
                <h1 className="text-lg font-semibold text-slate-800">
                  {targetMissed ? "Chưa đúng tài khoản quảng cáo của gian" : "Kết nối thành công"}
                </h1>
                <p className="text-sm text-slate-600">{message}</p>
                {targetMissed && (
                  <p className="text-sm text-slate-500">Tài khoản vừa ủy quyền đã được nối cho gian bên dưới.</p>
                )}
                {targetMissed && /vừa ủy quyền/.test(result.target?.reason ?? "") && (
                <p className="text-sm text-slate-500">
                  Bấm Kết nối lại, ở màn hình TikTok chọn <span className="font-medium text-slate-900">Switch account</span> (góc
                  phải ô tài khoản) rồi đăng nhập đúng tài khoản đang chạy quảng cáo cho gian.
                </p>
                )}
              </div>
              <ul className="w-full space-y-1 text-left text-sm text-slate-700">
                {result.linked.map((l) => (
                  <li key={l.channelId} className="rounded-md border border-slate-200 bg-card px-3 py-2">
                    <span className="font-medium">{l.shopName}</span>
                    <span className="text-slate-500"> · {l.advertiserName}</span>
                  </li>
                ))}
              </ul>
              {/* Bấm Kết nối ở dòng của MỘT gian thì chỉ nói về gian đó — các gian khác dùng
                  tài khoản quảng cáo khác là chuyện bình thường, kể ra chỉ làm rối. */}
              {!result.target && result.skipped.length > 0 && (
                <ul className="w-full space-y-1 text-left text-xs text-slate-500">
                  {result.skipped.map((s) => (
                    <li key={s.shopName}>
                      {s.shopName}: {s.reason}
                    </li>
                  ))}
                </ul>
              )}
              {isInvite ? (
                <p className="text-sm text-slate-500">
                  Chủ shop sẽ thấy số quảng cáo trên Hubsell sau ít phút. Anh/chị có thể đóng trang này.
                </p>
              ) : (
                <Button className="mt-2 w-full" onClick={() => router.push("/ads/tiktok")}>
                  Xem quảng cáo TikTok
                </Button>
              )}
            </>
          )}

          {phase === "error" && (
            <>
              <XCircle className="size-12 text-rose-500" />
              <div className="space-y-1">
                <h1 className="text-lg font-semibold text-slate-800">Chưa kết nối được</h1>
                <p className="text-sm text-slate-600">{message}</p>
                {wrongAccount && (
                <p className="text-sm text-slate-500">
                  Bấm Kết nối lại, ở màn hình TikTok chọn <span className="font-medium text-slate-900">Switch account</span> (góc
                  phải ô tài khoản) rồi đăng nhập đúng tài khoản đang chạy quảng cáo cho gian.
                </p>
                )}
              </div>
              <Button variant="outline" className="mt-2 w-full" onClick={() => router.push("/ads/tiktok")}>
                Về trang Quảng cáo TikTok
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
