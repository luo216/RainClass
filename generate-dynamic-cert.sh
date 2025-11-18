#!/bin/bash

# 动态生成SSL证书脚本
# 根据config.json中的ssl_ip配置生成证书

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSL_DIR="$SCRIPT_DIR/ssl"
CONFIG_FILE="$SCRIPT_DIR/config.json"

# 创建SSL目录
mkdir -p "$SSL_DIR"

# 从配置文件读取IP地址
if [ -f "$CONFIG_FILE" ]; then
    # 使用jq或sed提取IP地址
    if command -v jq &> /dev/null; then
        SSL_IP=$(jq -r '.server.ssl_ip' "$CONFIG_FILE")
    else
        # 如果没有jq，使用sed
        SSL_IP=$(grep -o '"ssl_ip": *"[^"]*"' "$CONFIG_FILE" | sed 's/.*"ssl_ip": *"\([^"]*\)".*/\1/')
    fi
    
    if [ "$SSL_IP" = "null" ] || [ -z "$SSL_IP" ]; then
        echo "❌ 错误: 无法从config.json中读取ssl_ip配置"
        exit 1
    fi
else
    echo "❌ 错误: 找不到config.json文件"
    exit 1
fi

echo "📋 为IP地址 $SSL_IP 生成SSL证书..."

# 删除旧证书
rm -f "$SSL_DIR/server.key" "$SSL_DIR/server.crt"

# 生成新的SSL证书
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$SSL_DIR/server.key" \
  -out "$SSL_DIR/server.crt" \
  -subj "/C=CN/ST=Beijing/L=Beijing/O=Yuketang/OU=Dev/CN=$SSL_IP" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:$SSL_IP,DNS:$SSL_IP" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ SSL证书生成成功"
    echo "   证书文件: $SSL_DIR/server.crt"
    echo "   私钥文件: $SSL_DIR/server.key"
    echo "   支持的域名/IP: localhost, 127.0.0.1, $SSL_IP"
else
    echo "❌ SSL证书生成失败"
    exit 1
fi