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

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="$ROOT/certs"
mkdir -p "$CERT_DIR"

# MSYS_NO_PATHCONV=1: chặn Git Bash trên Windows biến "/CN=localhost" thành đường dẫn.
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$CERT_DIR/localhost-key.pem" \
  -out "$CERT_DIR/localhost.pem" \
  -days 825 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1"

echo "✅ Đã tạo chứng chỉ tại $CERT_DIR"
echo "   - localhost-key.pem (khóa riêng)"
echo "   - localhost.pem (chứng chỉ)"
echo ""
echo "Bước tiếp: trình duyệt sẽ cảnh báo cert tự ký — mở https://localhost:4000/health"
echo "và https://localhost:3000 một lần rồi bấm 'vẫn tiếp tục' để tin cert cho mỗi cổng."
