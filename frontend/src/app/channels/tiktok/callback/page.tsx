"use client";

// ============================================================
// TRANG CALLBACK OAUTH TIKTOK SHOP
//
// Hai lối vào (docs TIKTOK-APP-STORE-NIEM-YET.md mục 6):
//   1) Bấm Kết nối trên trang Kênh bán → TikTok trả về ?code=...&state=... →
//      đối chiếu state (chống CSRF) → gửi code lên backend đổi token.
//   2) Người bán CÀI TỪ App Store của Seller Center (app công khai) → TikTok chỉ
//      trả ?code=... (KHÔNG có state, người bán có thể chưa đăng nhập Hubsell):
//      - chưa đăng nhập → giữ code trong sessionStorage, đưa sang /login; đăng
//        nhập / tạo tài khoản xong trang login quay lại đây với ?resume=1;
//      - đã đăng nhập → hỏi xác nhận "nối vào tài khoản này" rồi mới đổi token
//        (thay cho state: người dùng tự bấm, link lạ không tự nối gian).
//
// Đọc tham số qua window.location.search (client-only) để khỏi cần bọc Suspense
// như khi dùng useSearchParams trong Next 16.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Store, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ApiError,
  clearToken,
  getStoredUser,
  getToken,
  tiktokCallback,
  type TiktokConnectedChannel,
} from "@/lib/api";

type Phase = "processing" | "confirm" | "success" | "error" | "app";

/** Khóa sessionStorage giữ mã ủy quyền khi cài từ App Store mà chưa đăng nhập. */
export const TIKTOK_STORE_CODE_KEY = "tiktok_store_code";
const STORE_CODE_AT_KEY = "tiktok_store_code_at";
/** Mã ủy quyền TikTok chỉ dùng được một lần và sống ngắn — quá mốc này thì
 *  đừng thử đổi nữa, bảo người bán cài lại (TikTok không công bố TTL, số tự chọn). */
const STORE_CODE_MAX_AGE_MS = 15 * 60 * 1000;

/** Deep link màn Gian hàng của app mobile — state tiền tố `app_` do backend
 *  sinh khi app xin link (lát 2, 28/10/2026; docs MOBILE-NOI-GIAN-GIA-VON.md). */
const APP_SCHEME = process.env.NEXT_PUBLIC_APP_MOBILE_SCHEME ?? "hubsellmobile";
const appReturnUrl = (code: string, state: string) =>
  `${APP_SCHEME}://channels?${new URLSearchParams({ tiktok: "code", code, state }).toString()}`;

const EXPIRED_HINT =
  "Mã ủy quyền có thể đã hết hạn. Hãy mở lại Hubsell trong App Store của Seller Center " +
  "hoặc bấm Kết nối TikTok Shop trên trang Kênh bán để ủy quyền lại.";

export default function TiktokCallbackPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("processing");
  const [message, setMessage] = useState("Đang xử lý uỷ quyền từ TikTok…");
  const [channels, setChannels] = useState<TiktokConnectedChannel[]>([]);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  /** Lối 3 — về app mobile: link để bấm tay nếu trình duyệt không tự mở app. */
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // React 18 StrictMode gọi effect 2 lần ở dev — auth_code chỉ dùng được MỘT LẦN,
  // nên chốt cờ để không đổi token hai lượt (lần sau sẽ lỗi "code đã dùng").
  const ranRef = useRef(false);

  function exchange(code: string, reconnectId?: string, fromStore = false) {
    setSubmitting(true);
    setPhase("processing");
    tiktokCallback(code, reconnectId)
      .then((res) => {
        setChannels(res.channels);
        setPhase("success");
        // BE kèm câu nói rõ chỉ kéo 3 tháng gần nhất (anh Trung 23/09).
        setMessage(
          `Đã kết nối ${res.connected} gian hàng TikTok Shop vào Hubsell.${res.message ? ` ${res.message}` : ""}`
        );
      })
      .catch((err) => {
        setPhase("error");
        const base =
          err instanceof ApiError ? err.message : "Không kết nối được máy chủ.";
        setMessage(fromStore ? `${base} ${EXPIRED_HINT}` : base);
      })
      .finally(() => setSubmitting(false));
  }

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const errorFromTiktok = params.get("error") || params.get("error_description");
    if (errorFromTiktok) {
      setPhase("error");
      setMessage(`TikTok từ chối uỷ quyền: ${errorFromTiktok}`);
      return;
    }

    // Quay lại sau khi đăng nhập (lối 2): lấy mã đã giữ trước khi rời trang.
    if (params.get("resume") === "1") {
      const code = sessionStorage.getItem(TIKTOK_STORE_CODE_KEY);
      const at = Number(sessionStorage.getItem(STORE_CODE_AT_KEY) ?? 0);
      sessionStorage.removeItem(TIKTOK_STORE_CODE_KEY);
      sessionStorage.removeItem(STORE_CODE_AT_KEY);
      window.history.replaceState({}, "", "/channels/tiktok/callback");
      if (!code || !getToken()) {
        setPhase("error");
        setMessage(`Không còn mã ủy quyền để tiếp tục. ${EXPIRED_HINT}`);
        return;
      }
      if (Date.now() - at > STORE_CODE_MAX_AGE_MS) {
        setPhase("error");
        setMessage(`Đăng nhập xong hơi lâu. ${EXPIRED_HINT}`);
        return;
      }
      setPendingCode(code);
      setPhase("confirm");
      return;
    }

    const code = params.get("code");
    const state = params.get("state");
    if (!code) {
      setPhase("error");
      setMessage("Không nhận được mã uỷ quyền (code) từ TikTok.");
      return;
    }

    // Lối 3 — ủy quyền khởi phát từ APP MOBILE (state tiền tố app_): không đổi
    // token ở đây (trình duyệt có thể chưa đăng nhập web), nảy nguyên code +
    // state về app để app gọi POST /api/channels/tiktok/callback bằng JWT của nó.
    if (state && state.startsWith("app_")) {
      const url = appReturnUrl(code, state);
      setAppUrl(url);
      setPhase("app");
      setMessage("Đang quay về app Hubsell…");
      window.location.replace(url);
      return;
    }

    // Lối 2 — cài từ App Store: TikTok không gửi state.
    if (!state) {
      if (!getToken()) {
        sessionStorage.setItem(TIKTOK_STORE_CODE_KEY, code);
        sessionStorage.setItem(STORE_CODE_AT_KEY, String(Date.now()));
        router.replace("/login?from=tiktok-store");
        return;
      }
      setPendingCode(code);
      setPhase("confirm");
      return;
    }

    // Lối 1 — đối chiếu state với giá trị đã lưu trước khi rời trang (chống CSRF).
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

    exchange(code, reconnectId);
    // router ổn định trong app router — chạy đúng một lần khi mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lối 2: người dùng muốn nối vào tài khoản Hubsell khác → giữ mã, đăng xuất, sang login.
  function switchAccount() {
    if (!pendingCode) return;
    sessionStorage.setItem(TIKTOK_STORE_CODE_KEY, pendingCode);
    sessionStorage.setItem(STORE_CODE_AT_KEY, String(Date.now()));
    clearToken();
    router.replace("/login?from=tiktok-store");
  }

  const user = phase === "confirm" ? getStoredUser() : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          {phase === "app" && (
            <>
              <Loader2 className="size-10 animate-spin text-slate-400" />
              <p className="text-slate-600">{message}</p>
              {appUrl && (
                <Button render={<a href={appUrl} />}>Mở app Hubsell</Button>
              )}
            </>
          )}
          {phase === "processing" && (
            <>
              <Loader2 className="size-10 animate-spin text-slate-400" />
              <p className="text-slate-600">{message}</p>
            </>
          )}

          {phase === "confirm" && pendingCode && (
            <>
              <Store className="size-12 text-emerald-500" />
              <div className="space-y-1">
                <h1 className="text-lg font-semibold text-slate-800">
                  Hoàn tất kết nối TikTok Shop
                </h1>
                <p className="text-sm text-slate-600">
                  Gian hàng vừa ủy quyền sẽ được nối vào tài khoản Hubsell
                  {user ? (
                    <>
                      {" "}
                      <b className="text-slate-800">{user.email || user.fullName}</b>
                    </>
                  ) : null}
                  . Sau khi nối, Hubsell kéo đơn 3 tháng gần nhất và bắt đầu đọc
                  chiến dịch quảng cáo của gian.
                </p>
              </div>
              <Button
                className="mt-2 w-full"
                disabled={submitting}
                onClick={() => exchange(pendingCode, undefined, true)}
              >
                Kết nối vào tài khoản này
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                disabled={submitting}
                onClick={switchAccount}
              >
                Dùng tài khoản Hubsell khác
              </Button>
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
