# 雨课堂代签到系统

## 🎯 项目概述

雨课堂代签到系统是一个功能完整的 Web 应用，提供雨课堂多账号自动签到和账号管理功能。系统通过微信扫码登录获取用户凭证，支持实时扫码签到、账号状态监控和一键部署。

## 🛠️ 技术栈

- **后端**: Node.js + Express.js
- **数据库**: SQLite3
- **前端**: Bootstrap 5 + 原生 JavaScript
- **通信**: WebSocket (实时消息推送)
- **安全**: HTTPS (自签名 SSL 证书)
- **API 集成**: 雨课堂 API
- **部署**: Bash 脚本一键部署

## 📁 项目结构

```
RainClass/
├── deploy.sh                   # 🚀 一键部署脚本
├── generate-dynamic-cert.sh    # 🔐 SSL证书生成脚本
├── config.json                 # ⚙️ 系统配置文件
├── package.json                # 📦 项目依赖和脚本
├── IFLOW.md                   # 📖 项目文档
├── server/                     # 🖥️ 后端代码目录
│   ├── app.js                 # 主应用入口
│   ├── database.js            # 数据库操作模块
│   └── yuketangAPI.js         # 雨课堂 API 封装
├── public/                     # 🌐 前端静态文件
│   ├── admin.html             # 管理界面
│   ├── admin.js               # 管理端交互逻辑
│   ├── scanner.html           # 扫码界面
│   └── scanner.js             # 扫码端交互逻辑
├── logs/                       # 📝 日志和数据库文件
└── ssl/                        # 🔒 SSL 证书目录
```

## ✨ 核心功能

### 1. 🎫 微信扫码登录
- 通过 WebSocket 连接获取二维码
- 实时监控扫码状态和登录进度
- 自动保存用户凭证和账号信息
- 支持多账号并发管理

### 2. 📱 移动端扫码签到
- 手机端扫码界面，支持摄像头调用
- 实时二维码识别和URL提取
- WebSocket 长连接支持多用户并发签到
- 完整的响应数据展示（状态码+响应内容）

### 3. 👥 账号管理
- 支持多账号添加、删除、状态检查
- 账号登录状态实时监控
- Cookie 有效性批量验证
- 账号信息持久化存储

### 4. 🚀 一键部署
- 完整的部署脚本自动化
- 依赖检查和自动安装
- SSL 证书动态生成
- 服务进程管理和日志查看

### 5. 🔒 安全特性
- HTTPS 加密传输
- 动态 SSL 证书生成
- CORS 跨域支持
- WebSocket 安全连接

## 🚀 快速开始

### 环境要求
- **Node.js** >= 14.0.0
- **npm** (通常随 Node.js 一起安装)
- **OpenSSL** (用于 SSL 证书生成)
- **系统**: Linux/macOS/Windows

### 一键部署
```bash
# 1. 克隆或下载项目
git clone <项目地址>
cd RainClass

# 2. 执行一键部署
chmod +x deploy.sh
./deploy.sh install    # 安装依赖
./deploy.sh start      # 启动服务
```

### 配置系统
编辑 `config.json` 文件，设置服务器参数：
```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 10000,
    "ssl_ip": "192.168.1.100"
  }
}
```

### 访问系统
- **管理界面**: `https://你的IP地址:10000/admin.html`
- **扫码界面**: `https://你的IP地址:10000/scanner`

## 📡 API 接口

### 账号管理
- `GET /api/accounts` - 获取账号列表
- `DELETE /api/accounts/:id` - 删除账号
- `DELETE /api/accounts/:id/hard` - 硬删除账号
- `POST /api/accounts/check-status` - 检查单个账号状态
- `POST /api/accounts/check-all-status` - 批量检查账号状态
- `POST /api/accounts/:id/clear-cookies` - 清除账号 Cookie

### 扫码登录
- `POST /api/scan-login/start` - 开始扫码登录
- `POST /api/scan-login/save` - 保存扫码登录账号

### 扫码签到
- `WebSocket /` - 实时签到请求处理
- `GET /scanner` - 扫码界面路由

## 🛠️ 部署脚本使用

### 基本命令
```bash
./deploy.sh help         # 显示帮助信息
./deploy.sh install      # 安装项目依赖
./deploy.sh start        # 启动服务
./deploy.sh stop         # 停止服务
./deploy.sh restart      # 重启服务
./deploy.sh logs         # 查看实时日志
```

### 服务器部署
```bash
# 1. 上传项目到服务器
scp -r RainClass/ user@server:/path/to/

# 2. 服务器上执行部署
cd RainClass
./deploy.sh install
./deploy.sh start

# 3. 配置防火墙（如需要）
sudo ufw allow 10000
```

### 功能特性
- ✅ 自动依赖检查 (Node.js + npm 版本验证)
- ✅ SSL 证书动态生成
- ✅ 端口占用检测
- ✅ 进程管理和状态监控
- ✅ 彩色日志输出
- ✅ 错误处理和异常捕获

## 🏗️ 开发指南

### 数据库结构
系统使用 SQLite 数据库，包含 `accounts` 表：
- `id`: 主键
- `uid`: 用户唯一标识
- `name`: 用户姓名
- `status`: 登录状态 (0=未登录, 1=已登录)
- `cookie`: 用户认证凭证 (JSON 格式)
- `created_at`: 创建时间

### 日志系统
系统日志保存在 `logs/server.log` 文件中，包含：
- 服务器启动信息
- API 请求日志
- WebSocket 连接日志
- 扫码签到记录
- 错误和异常信息

### WebSocket 通信
WebSocket 用于实时推送：
- **连接地址**: `wss://你的IP地址:10000`
- **消息格式**: JSON
- **主要事件**:
  - `register`: 会话注册
  - `login_success`: 登录成功
  - `signin_result`: 签到结果
  - `signin_error`: 签到错误

### 前端架构
- **管理界面** (`admin.html`): 账号管理、状态监控
- **扫码界面** (`scanner.html`): 移动端扫码签到
- **响应式设计**: 支持 PC 和移动端访问
- **实时通信**: WebSocket 连接确保数据同步

## 🌐 部署说明

### SSL 证书
系统每次启动会自动生成 SSL 证书，证书基于 `config.json` 中的 `ssl_ip` 配置。

### 防火墙设置
确保防火墙允许以下端口：
- **HTTPS**: 10000 (或自定义端口)
- **WebSocket**: 与 HTTPS 相同端口

### 服务器部署
```bash
# 基本部署
./deploy.sh install && ./deploy.sh start

# 查看服务状态
./deploy.sh logs

# 重启服务
./deploy.sh restart
```

### 生产环境建议
1. **进程管理**: 使用 PM2 或 systemd
2. **反向代理**: 配置 Nginx 或 Apache
3. **域名配置**: 申请正式 SSL 证书
4. **监控告警**: 设置服务状态监控
5. **备份策略**: 定期备份数据库和配置

## 🔧 故障排除

### 常见问题
1. **SSL 证书错误**: 检查 `config.json` 中的 `ssl_ip` 配置
2. **WebSocket 连接失败**: 确保防火墙允许 WebSocket 连接
3. **扫码登录失败**: 检查网络连接和雨课堂 API 可用性
4. **端口占用**: 使用 `lsof -i:10000` 检查端口占用
5. **依赖安装失败**: 检查 Node.js 版本是否符合要求

### 调试命令
```bash
# 查看实时日志
./deploy.sh logs

# 检查服务状态
pgrep -f "node server/app.js"

# 查看端口占用
lsof -i:10000

# 测试 SSL 证书
openssl s_client -connect localhost:10000
```

### 日志分析
```bash
# 查看错误日志
grep ERROR logs/server.log

# 查看 WebSocket 连接
grep WebSocket logs/server.log

# 查看签到记录
grep签到 logs/server.log
```

## 🛡️ 安全注意事项

1. **使用限制**: 系统仅用于学习和研究目的
2. **合规使用**: 请遵守相关平台的使用条款
3. **生产环境**: 不要在生产环境中使用默认配置
4. **安全更新**: 定期更新依赖包以修复安全漏洞
5. **数据保护**: 妥善保管用户凭证和敏感信息

## 📝 更新日志

### v1.0.0 (2025-11-19)
- ✅ 完整的扫码签到功能
- ✅ 移动端扫码界面
- ✅ WebSocket 实时通信
- ✅ 多账号并发签到
- ✅ 一键部署脚本
- ✅ HTTPS 安全连接
- ✅ 账号状态管理

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 发起 Pull Request

## 📄 许可证

ISC License