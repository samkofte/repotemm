#!/usr/bin/env bash
# RemoteMM Enterprise - Self-Signed SSL Certificate Generator for Local Dev & VPS Staging
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CERTS_DIR="$PROJECT_ROOT/nginx/certs"

mkdir -p "$CERTS_DIR"

CERT_FILE="$CERTS_DIR/fullchain.pem"
KEY_FILE="$CERTS_DIR/privkey.pem"

DOMAIN="${1:-localhost}"

echo "[RemoteMM] Generating self-signed SSL certificate for domain: $DOMAIN..."

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$KEY_FILE" \
  -out "$CERT_FILE" \
  -subj "/C=TR/ST=Istanbul/L=Istanbul/O=RemoteMM Enterprise/CN=$DOMAIN" \
  -addext "subjectAltName=DNS:$DOMAIN,DNS:localhost,IP:127.0.0.1"

chmod 600 "$KEY_FILE"
chmod 644 "$CERT_FILE"

echo "[RemoteMM] SSL certificates successfully created:"
echo "  Certificate: $CERT_FILE"
echo "  Private Key: $KEY_FILE"
echo "[RemoteMM] You can now enable HTTPS in nginx/conf.d/remotemm.conf."
