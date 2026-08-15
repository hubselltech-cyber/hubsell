"use client";

// ============================================================
// TRANG CALLBACK OAUTH TIKTOK SHOP
//
// TikTok chuyển hướng về đây kèm ?code=...&state=... sau khi người bán uỷ quyền.
// Trang này: đối chiếu state (chống CSRF) → gửi code lên backend đổi token →
// báo kết quả → đưa người dùng về /channels.
//
// Đọc tham số qua window.location.search (client-only) để khỏi cần bọc Suspense
// như khi dùng useSearchParams trong Next 16.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ApiError,
  tiktokCallback,
  type TiktokConnectedChannel,
} from "@/lib/api";

type Phase = "processing" | "success" | "error";

export default function TiktokCallbackPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("processing");
  const [message, setMessage] = useState("Đang xử lý uỷ quyền từ TikTok…");
  const [channels, setChannels] = useState<TiktokConnectedChannel[]>([]);
  // React 18 StrictMode gọi effect 2 lần ở dev — auth_code chỉ dùng được MỘT LẦN,
  // nên chốt cờ để không đổi token hai lượt (lần sau sẽ lỗi "code đã dùng").
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const errorFromTiktok = params.get("error") || params.get("error_description");

    if (errorFromTiktok) {
      setPhase("error");
      setMessage(`TikTok từ chối uỷ quyền: ${errorFromTiktok}`);
      return;
    }
    if (!code) {
      setPhase("error");
      setMessage("Không nhận được mã uỷ quyền (code) từ TikTok.");
      return;
    }

    // Đối chiếu state với giá trị đã lưu trước khi rời trang (chống CSRF).
    const savedState = sessionStorage.getItem("tiktok_oauth_state");
    sessionStorage.removeItem("tiktok_oauth_state");
    // Gian đích của luồng "Kết nối lại" (trang Kênh bán lưu trước khi chuyển
    // hướng) — backend đối chiếu danh sách shop vừa uỷ quyền có chứa gian này.
    const reconnectId =
      sessionStorage.getItem("tiktok_reconnect_channel_id") ?? undefined;
    sessionStorage.removeItem("tiktok_reconnect_channel_id");
    if (!savedState || savedState !== state) {
      setPhase("error");
      setMessage(
        "Phiên uỷ quyền không khớp (state sai). Hãy thử kết nối lại từ đầu."
      );
      return;
    }

    tiktokCallback(code, reconnectId)
      .then((res) => {
        setChannels(res.channels);
        setPhase("success");
        setMessage(
          `Đã kết nối ${res.connected} gian hàng TikTok Shop vào Hubsell.`
        );
      })
      .catch((err) => {
        setPhase("error");
        setMessage(
          err instanceof ApiError ? err.message : "Không kết nối được máy chủ."
        );
      });
  }, []);

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

          {phase === "success" && (
            <>
              <CheckCircle2 className="size-12 text-emerald-500" />
              <div className="space-y-1">
                <h1 className="text-lg font-semibold text-slate-800">
                  Kết nối thành công
                </h1>
                <p className="text-sm text-slate-600">{message}</p>
              </div>
              {channels.length > 0 && (
                <ul className="w-full space-y-1 text-left text-sm text-slate-700">
                  {channels.map((c) => (
                    <li
                      key={c.id}
                      className="rounded-md border border-slate-200 bg-card px-3 py-2"
                    >
                      {c.shopName}
                    </li>
                  ))}
                </ul>
              )}
              <Button className="mt-2 w-full" onClick={() => router.push("/channels")}>
                Về trang Kênh bán
              </Button>
            </>
          )}

          {phase === "error" && (
            <>
              <XCircle className="size-12 text-rose-500" />
              <div className="space-y-1">
                <h1 className="text-lg font-semibold text-slate-800">
                  Kết nối thất bại
                </h1>
                <p className="text-sm text-slate-600">{message}</p>
              </div>
              <Button
                variant="outline"
                className="mt-2 w-full"
                onClick={() => router.push("/channels")}
              >
                Quay lại trang Kênh bán
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
