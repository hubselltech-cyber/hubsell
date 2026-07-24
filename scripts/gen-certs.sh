#!/usr/bin/env bash
# ============================================================
# Tạo chứng chỉ SSL TỰ KÝ cho localhost (dùng test HTTPS ở local).
#
# Sinh ra certs/localhost-key.pem + certs/localhost.pem, phủ SAN cho
# localhost + 127.0.0.1 (bắt buộc, trình duyệt hiện đại bỏ qua CN, chỉ đọc SAN).
#
# Dùng: bash scripts/gen-certs.sh   (cần OpenSSL; Git Bash trên Windows có sẵn)
# Cert đã nằm trong .gitignore — mỗi máy tự tạo, không commit khóa riêng.
# ============================================================
set -euo pipefail

# Vào thư mục gốc repo rồi dùng ĐƯỜNG DẪN TƯƠNG ĐỐI cho openssl. Lý do: openssl là
# exe Windows, còn MSYS_NO_PATHCONV=1 (bắt buộc để "/CN=localhost" không bị Git Bash
# biến thành đường dẫn) lại chặn luôn việc đổi đường dẫn TUYỆT ĐỐI kiểu /d/... sang
# D:\... → openssl không mở được. Đường dẫn tương đối "certs/..." không dính vấn đề này.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p certs

MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/localhost-key.pem \
  -out certs/localhost.pem \
  -days 825 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1"

echo "✅ Đã tạo chứng chỉ tại $ROOT/certs"
echo "   - localhost-key.pem (khóa riêng)"
echo "   - localhost.pem (chứng chỉ)"
echo ""
echo "Bước tiếp: trình duyệt sẽ cảnh báo cert tự ký — mở https://localhost:4000/health"
echo "và https://localhost:3000 một lần rồi bấm 'vẫn tiếp tục' để tin cert cho mỗi cổng."
