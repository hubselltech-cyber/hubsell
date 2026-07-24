#!/usr/bin/env bash
# ============================================================
# HUBSELL — KHỞI ĐỘNG MÔI TRƯỜNG TEST HTTPS BẰNG MỘT LỆNH
#
#   bash scripts/dev-https.sh
#
# Việc script làm:
#   1. Tắt mọi tiến trình cũ đang giữ cổng 4000 (backend) và 3000 (frontend).
#   2. Đảm bảo có cert (tự chạy gen-certs nếu thiếu).
#   3. Boot Backend (HTTPS :4000) + Frontend (HTTPS :3000) cùng lúc.
#   4. Nếu có cloudflared/ngrok/lt → phơi cổng backend ra URL public (cho webhook).
#   5. In ra các đường link để click vào test ngay.
#
# Tùy chọn:  NO_TUNNEL=1 bash scripts/dev-https.sh   (bỏ qua bước tunnel)
# Dừng tất cả: nhấn Ctrl+C.
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BACKEND_PORT=4000
FRONTEND_PORT=3000
LOG_DIR="$ROOT/.dev-logs"
mkdir -p "$LOG_DIR"

# --- Tắt tiến trình đang LISTENING trên một cổng (Windows: netstat + taskkill) ---
kill_port() {
  local port="$1" pids pid
  pids=$(netstat -ano 2>/dev/null | grep -iE "LISTENING" | grep -E ":$port[[:space:]]" | awk '{print $NF}' | sort -u)
  for pid in $pids; do
    if [ -n "$pid" ] && [ "$pid" != "0" ]; then
      MSYS_NO_PATHCONV=1 taskkill /F /PID "$pid" >/dev/null 2>&1 && echo "   • đã tắt PID $pid (cổng $port)"
    fi
  done
}

# --- Chờ một URL trả lời (curl -k để chấp nhận cert tự ký) ---
wait_url() {
  local url="$1" name="$2" tries=60
  printf "   chờ %s " "$name"
  while [ "$tries" -gt 0 ]; do
    if curl -sk --max-time 2 "$url" >/dev/null 2>&1; then echo "✓"; return 0; fi
    printf "."; sleep 1; tries=$((tries - 1))
  done
  echo " (chưa lên — xem $LOG_DIR/$name.log)"
  return 1
}

TUNNEL_PID=""
TUNNEL_URL=""

start_tunnel() {
  if [ "${NO_TUNNEL:-0}" = "1" ]; then
    echo "▶ Bỏ qua tunnel (NO_TUNNEL=1)."
    return
  fi
  local up="https://localhost:$BACKEND_PORT"
  if command -v cloudflared >/dev/null 2>&1; then
    echo "▶ Phơi cổng backend qua cloudflared..."
    cloudflared tunnel --url "$up" --no-tls-verify >"$LOG_DIR/tunnel.log" 2>&1 &
    TUNNEL_PID=$!
    local i
    for i in $(seq 1 30); do
      TUNNEL_URL=$(grep -oE "https://[a-zA-Z0-9._-]+\.trycloudflare\.com" "$LOG_DIR/tunnel.log" 2>/dev/null | head -1)
      [ -n "$TUNNEL_URL" ] && break
      sleep 1
    done
  elif command -v ngrok >/dev/null 2>&1; then
    echo "▶ Phơi cổng backend qua ngrok..."
    ngrok http "$up" --log stdout >"$LOG_DIR/tunnel.log" 2>&1 &
    TUNNEL_PID=$!
    local i
    for i in $(seq 1 30); do
      TUNNEL_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -oE "https://[a-zA-Z0-9._-]+\.ngrok[a-zA-Z0-9.-]*" | head -1)
      [ -n "$TUNNEL_URL" ] && break
      sleep 1
    done
  elif command -v lt >/dev/null 2>&1; then
    echo "▶ Phơi cổng backend qua localtunnel (lt)..."
    lt --port "$BACKEND_PORT" >"$LOG_DIR/tunnel.log" 2>&1 &
    TUNNEL_PID=$!
    local i
    for i in $(seq 1 30); do
      TUNNEL_URL=$(grep -oE "https://[a-zA-Z0-9._-]+\.loca\.lt" "$LOG_DIR/tunnel.log" 2>/dev/null | head -1)
      [ -n "$TUNNEL_URL" ] && break
      sleep 1
    done
  else
    echo "▶ Không thấy cloudflared/ngrok/lt → bỏ qua tunnel."
    echo "   (Muốn nhận webhook thật: cài cloudflared rồi chạy lại — khuyến nghị cho webhook.)"
  fi
}

CLEANED=0
cleanup() {
  [ "$CLEANED" = "1" ] && return
  CLEANED=1
  echo ""
  echo "▶ Đang tắt tất cả..."
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" >/dev/null 2>&1
  [ -n "${BACK_PID:-}" ] && kill "$BACK_PID" >/dev/null 2>&1
  [ -n "${FRONT_PID:-}" ] && kill "$FRONT_PID" >/dev/null 2>&1
  kill_port "$BACKEND_PORT"
  kill_port "$FRONTEND_PORT"
  echo "▶ Xong."
  exit 0
}
trap cleanup INT TERM

# ---------- 1) Dọn tiến trình cũ ----------
echo "▶ Dọn tiến trình cũ trên cổng $BACKEND_PORT / $FRONTEND_PORT..."
kill_port "$BACKEND_PORT"
kill_port "$FRONTEND_PORT"
sleep 1

# ---------- 2) Đảm bảo có cert ----------
if [ ! -f certs/localhost.pem ] || [ ! -f certs/localhost-key.pem ]; then
  echo "▶ Chưa có cert — đang tạo..."
  bash scripts/gen-certs.sh
fi

# ---------- 3) Boot backend + frontend ----------
echo "▶ Khởi động Backend (HTTPS :$BACKEND_PORT)..."
( cd backend && npm run dev ) >"$LOG_DIR/backend.log" 2>&1 &
BACK_PID=$!

echo "▶ Khởi động Frontend (HTTPS :$FRONTEND_PORT)..."
( cd frontend && npm run dev:https ) >"$LOG_DIR/frontend.log" 2>&1 &
FRONT_PID=$!

echo "▶ Chờ hai máy chủ sẵn sàng..."
wait_url "https://localhost:$BACKEND_PORT/health" "backend"
wait_url "https://localhost:$FRONTEND_PORT" "frontend"

# ---------- 4) Tunnel ----------
start_tunnel

# ---------- 5) In link ----------
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "   HUBSELL — MÔI TRƯỜNG TEST HTTPS ĐÃ SẴN SÀNG"
echo "────────────────────────────────────────────────────────────────"
echo "   🖥  Frontend : https://localhost:$FRONTEND_PORT"
echo "   ⚙  Backend  : https://localhost:$BACKEND_PORT/health"
echo "   ↩  Callback : https://localhost:$FRONTEND_PORT/channels/tiktok/callback"
if [ -n "$TUNNEL_URL" ]; then
  echo "   🌐 Tunnel   : $TUNNEL_URL"
  echo "   🪝 Webhook  : $TUNNEL_URL/api/webhooks/tiktok"
  echo "                 └─ khai URL này ở TikTok Partner Center → Webhook"
else
  echo "   🌐 Tunnel   : (không có — cài cloudflared/ngrok để nhận webhook thật)"
fi
echo "────────────────────────────────────────────────────────────────"
echo "   ⚠  Lần đầu: mở link Backend ở trên, bấm 'vẫn tiếp tục' để trình"
echo "      duyệt TIN cert tự ký (làm cho cả cổng 3000 và 4000)."
echo "   ⏹  Nhấn Ctrl+C để tắt toàn bộ."
echo "════════════════════════════════════════════════════════════════"

# Giữ script chạy nền để Ctrl+C tắt được mọi tiến trình con.
wait
