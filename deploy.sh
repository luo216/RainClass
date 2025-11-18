#!/bin/bash

# 雨课堂代签到系统 - 一键部署脚本
# 使用方法: ./deploy.sh [start|stop|restart|logs|install]

set -e  # 遇到任何错误时退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目信息
PROJECT_NAME="雨课堂代签到系统"
VERSION="1.0.0"
NODE_VERSION="14.0.0"

# 日志函数
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# 显示帮助信息
show_help() {
    cat << EOF
${YELLOW}雨课堂代签到系统 - 一键部署脚本${NC}

${BLUE}使用方法:${NC}
  $0 [start]   启动服务
  $0 [stop]    停止服务
  $0 [restart] 重启服务
  $0 [logs]    查看日志
  $0 [install] 安装依赖
  $0 [help]    显示帮助信息

${BLUE}示例:${NC}
  $0 ./deploy.sh start    # 启动服务
  $0 ./deploy.sh restart  # 重启服务
  $0 ./deploy.sh logs     # 查看日志

${YELLOW}端口信息:${NC}
  - HTTP: https://localhost:10000
  - 管理界面: https://localhost:10000/admin.html
  - 扫码界面: https://localhost:10000/scanner

EOF
}

# 检查依赖
check_dependencies() {
    info "检查系统依赖..."
    
    # 检查Node.js
    if ! command -v node &> /dev/null; then
        error "Node.js 未安装，请先安装 Node.js (版本 >= $NODE_VERSION)"
    fi
    
    local node_version=$(node --version | cut -d'v' -f1)
    if [ "$(printf '%s\n' "$node_version" "$NODE_VERSION")" = "$(printf '%s\n' "$NODE_VERSION" "$NODE_VERSION")" ]; then
        error "Node.js 版本过低，当前: $node_version，需要: >= $NODE_VERSION"
    fi
    
    # 检查npm
    if ! command -v npm &> /dev/null; then
        error "npm 未安装，请先安装 npm"
    fi
    
    success "依赖检查通过"
}

# 安装依赖
install_dependencies() {
    info "安装项目依赖..."
    
    if [ ! -d "node_modules" ]; then
        npm install
        success "依赖安装完成"
    else
        info "依赖已存在，跳过安装"
    fi
}

# 生成SSL证书
generate_ssl_cert() {
    info "生成SSL证书..."
    
    # 给脚本添加执行权限
    if [ -f "generate-dynamic-cert.sh" ]; then
        chmod +x generate-dynamic-cert.sh
    else
        error "SSL证书生成脚本不存在"
    fi
    
    # 执行证书生成
    ./generate-dynamic-cert.sh
    
    success "SSL证书生成完成"
}

# 启动服务
start_service() {
    info "启动 $PROJECT_NAME 服务..."
    
    # 检查端口是否被占用
    if lsof -i:TCP -P:$PORT -sTCP:LISTEN 2>/dev/null; then
        error "端口 $PORT 已被占用，请停止其他服务或更改端口"
    fi
    
    # 启动服务
    if pgrep -f "node server/app.js" > /dev/null; then
        info "服务已在运行中"
    else
        nohup node server/app.js > server_output.log 2>&1 &
        sleep 2
        
        if pgrep -f "node server/app.js" > /dev/null; then
            success "$PROJECT_NAME 启动成功"
            info "访问地址: https://localhost:$PORT/admin.html"
        else
            error "服务启动失败，请检查日志: tail -f server_output.log"
        fi
    fi
}

# 停止服务
stop_service() {
    info "停止 $PROJECT_NAME 服务..."
    
    # 查找并终止进程
    local pids=$(pgrep -f "node server/app.js" | awk '{print $1}')
    
    if [ -n "$pids" ]; then
        echo "找到进程: $pids"
        kill $pids
        sleep 2
        
        # 检查进程是否已终止
        if pgrep -f "node server/app.js" > /dev/null; then
            error "服务停止失败，请手动终止进程"
        else
            success "$PROJECT_NAME 已停止"
        fi
    else
        info "服务未运行"
    fi
}

# 重启服务
restart_service() {
    info "重启 $PROJECT_NAME 服务..."
    
    stop_service
    sleep 2
    start_service
}

# 查看日志
show_logs() {
    info "显示服务日志..."
    
    if [ -f "server_output.log" ]; then
        tail -f server_output.log
    else
        info "日志文件不存在"
    fi
}

# 检查服务状态
check_service_status() {
    if pgrep -f "node server/app.js" > /dev/null; then
        info "服务状态: 运行中"
        info "PID: $(pgrep -f "node server/app.js" | awk '{print $1}')"
        info "端口: $PORT"
        info "访问地址: https://localhost:$PORT/admin.html"
    else
        info "服务状态: 未运行"
    fi
}

# 主函数
main() {
    local command=${1:-help}
    
    # 读取配置文件获取端口
    if [ -f "config.json" ]; then
        PORT=$(grep -o '"port": *' config.json | grep -o '[0-9]*' | head -1)
        PORT=${PORT:-10000}
    else
        PORT=10000
    fi
    
    log "$PROJECT_NAME v$VERSION - 一键部署脚本"
    
    case "$command" in
        "start")
            check_dependencies
            generate_ssl_cert
            start_service
            ;;
        "stop")
            stop_service
            ;;
        "restart")
            restart_service
            ;;
        "logs")
            show_logs
            ;;
        "install")
            install_dependencies
            ;;
        "help"|"-h"|"--help")
            show_help
            ;;
        *)
            show_help
            exit 0
            ;;
    esac
}

# 执行主函数
main "$@"