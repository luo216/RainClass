const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const Database = require('./database');
const YuketangAPI = require('./yuketangAPI');
const WebSocket = require('ws');
const https = require('https');
const { execSync } = require('child_process');

const app = express();

// 读取配置文件
let config;
try {
    config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
} catch (error) {
    console.error('❌ 读取配置文件失败:', error.message);
    process.exit(1);
}

const PORT = config.server.port || 10000;
const HOST = config.server.host || '0.0.0.0';
const SSL_IP = config.server.ssl_ip;
const db = new Database();

// 临时会话存储
let tempSessions = {};
// WebSocket连接存储
let wsConnections = new Map(); // sessionId -> WebSocket connection

// 日志写入函数
function writeLog(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] Server: ${message}`;
    console.log(logMessage);
    
    // 写入到日志文件
    fs.appendFile(path.join(__dirname, '../logs/server.log'), logMessage + '\n', (err) => {
        if (err) {
            console.error('写入日志文件失败:', err);
        }
    });
}

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// WebSocket服务器将在HTTP服务器创建后初始化
let wss;

// WebSocket连接管理
function setupWebSocket(server) {
    wss = new WebSocket.Server({ 
        server,
        verifyClient: (info) => {
            // 允许所有连接
            return true;
        }
    });
    
    console.log('WebSocket服务器已初始化，支持WSS连接');
    
    wss.on('connection', (ws) => {
        console.log('新的WebSocket连接建立');
        
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                
                if (data.type === 'register') {
                    // 注册会话
                    wsConnections.set(data.sessionId, ws);
                    ws.send(JSON.stringify({
                        type: 'registered',
                        sessionId: data.sessionId
                    }));
                    console.log(`WebSocket会话注册: ${data.sessionId}`);
                } else if (data.type === 'signin') {
                    // 处理签到请求
                    handleSigninRequest(ws, data);
                }
            } catch (error) {
                console.error('WebSocket消息解析错误:', error);
            }
        });
    
    ws.on('close', () => {
            // 清理连接
            for (const [sessionId, connection] of wsConnections.entries()) {
                if (connection === ws) {
                    wsConnections.delete(sessionId);
                    console.log(`WebSocket会话断开: ${sessionId}`);
                    break;
                }
            }
        });
    });
}

// 发送WebSocket消息
function sendWebSocketMessage(sessionId, type, data) {
    const connection = wsConnections.get(sessionId);
    if (connection && connection.readyState === WebSocket.OPEN) {
        connection.send(JSON.stringify({
            type: type,
            data: data
        }));
        console.log(`WebSocket消息已发送: ${sessionId} - ${type}`);
    }
}



// 静态文件路由
app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// 扫码界面路由
app.get('/scanner', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/scanner.html'));
});

// API路由

// 获取账号列表
app.get('/api/accounts', async (req, res) => {
    try {
        const accounts = await db.getAllAccounts();
        res.json({ success: true, data: accounts });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 扫码登录 - 开始
app.post('/api/scan-login/start', async (req, res) => {
    try {
        // 生成临时会话ID
        const sessionId = 'scan_login_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // 保存临时会话信息
        tempSessions = tempSessions || {};
        tempSessions[sessionId] = {
            createdAt: new Date(),
            status: 'waiting_for_qr'
        };

        writeLog(`创建扫码登录会话: ${sessionId}`);

        // 获取雨课堂登录页面和二维码
        const api = new YuketangAPI();
        const qrResult = await api.getWeChatQRCode();
        
        if (!qrResult.success) {
            delete tempSessions[sessionId];
            return res.status(500).json({ 
                success: false, 
                message: `获取二维码失败: ${qrResult.message}` 
            });
        }

        // 设置登录成功回调
        api.setLoginSuccessCallback((loginResult) => {
            console.log(`扫码登录成功回调: ${sessionId}`);
            
            // 更新会话状态
            if (tempSessions && tempSessions[sessionId]) {
                tempSessions[sessionId].status = 'login_success';
                tempSessions[sessionId].loginResult = loginResult;
                
                // 保存用户信息
                tempSessions[sessionId].userInfo = {
                    userId: loginResult.data.userId,
                    name: loginResult.data.name,
                    school: loginResult.data.school,
                    department: loginResult.data.department
                };
                
                console.log(`登录成功，用户: ${loginResult.data.name} (ID: ${loginResult.data.userId})`);
                
                // 通过WebSocket推送登录成功消息
                sendWebSocketMessage(sessionId, 'login_success', {
                    step: 'auto_save',
                    userInfo: tempSessions[sessionId].userInfo,
                    cookies: loginResult.data.cookies,
                    message: `登录成功！用户: ${loginResult.data.name}`
                });
            }
        });

        // 更新会话信息
        tempSessions[sessionId].qrData = qrResult.data;
        tempSessions[sessionId].status = 'qr_ready';
        tempSessions[sessionId].api = api;
        tempSessions[sessionId].loginid = qrResult.data.loginid;

        res.json({ 
            success: true, 
            message: '二维码获取成功',
            data: {
                sessionId: sessionId,
                loginid: qrResult.data.loginid,
                qrCodeUrl: qrResult.data.qrCodeUrl,
                qrcode: qrResult.data.qrcode,
                expire_seconds: qrResult.data.expire_seconds
            }
        });

    } catch (error) {
        console.error('扫码登录出错:', error);
        res.status(500).json({ 
            success: false, 
            message: `系统错误: ${error.message}` 
        });
    }
});



// 扫码登录 - 保存
app.post('/api/scan-login/save', async (req, res) => {
    try {
        const { sessionId, name, cookies, userId } = req.body;
        
        if (!sessionId || !name || !cookies) {
            return res.status(400).json({ 
                success: false, 
                message: '会话ID、姓名和Cookie不能为空' 
            });
        }

        // 微信扫码登录获取的Cookie无需验证，直接保存
        writeLog(`微信扫码登录获取Cookie，用户: ${name}, Cookie数量: ${cookies.length}`);

        let account;
        
        // 直接创建新账号
        const uidToUse = userId || 'scan_login_' + Date.now();
        
        // 检查userid是否已存在
        const existingAccount = await db.getAccountByUid(uidToUse);
        if (existingAccount) {
            return res.status(400).json({ 
                success: false, 
                message: `该UserID (${uidToUse}) 已存在，无法重复添加` 
            });
        }
        
        writeLog(`保存扫码登录账号: ${name} (UID: ${uidToUse}), Cookie数量: ${cookies.length}`);
        
        // 创建新账号，初始状态为已登录（status = 1）
        account = await db.addAccount(uidToUse, name, cookies, 1);
        writeLog(`创建新账号: ${name} (UID: ${uidToUse}), 状态: 已登录`);
        
        // 更新会话状态
        if (tempSessions && tempSessions[sessionId]) {
            tempSessions[sessionId].waitingForName = false;
            tempSessions[sessionId].saved = true;
            tempSessions[sessionId].accountId = account.id;
            
            // 关闭WebSocket连接
            if (tempSessions[sessionId].api) {
                tempSessions[sessionId].api.closeWebSocketConnection();
            }
        }
        
        writeLog(`扫码登录账号保存成功: ${name}, 账号ID: ${account.id}`);
        
        res.json({ 
            success: true, 
            message: '账号添加成功',
            data: {
                accountId: account.id,
                name: name,
                uid: account.uid
            }
        });

    } catch (error) {
        console.error('保存扫码登录账号出错:', error);
        res.status(500).json({ 
            success: false, 
            message: `系统错误: ${error.message}` 
        });
    }
});



// 处理签到请求
async function handleSigninRequest(ws, data) {
    try {
        const { url, sessionId } = data;
        
        if (!url) {
            ws.send(JSON.stringify({
                type: 'signin_error',
                message: 'URL不能为空'
            }));
            return;
        }

        writeLog(`收到签到请求: ${url.substring(0, 50)}...`);
        
        // 获取所有有效账号
        const accounts = await db.getActiveAccounts();
        
        if (accounts.length === 0) {
            ws.send(JSON.stringify({
                type: 'signin_error',
                message: '没有可用的账号'
            }));
            return;
        }

        writeLog(`开始为 ${accounts.length} 个账号执行签到...`);
        
        // 并发执行签到请求
        const signinPromises = accounts.map(async (account) => {
            const axios = require('axios');
            const result = {
                accountId: account.id,
                name: account.name,
                success: false,
                statusCode: null,
                responseText: null,
                headers: null,
                error: null
            };
            
            try {
                // 构建请求头
                const cookieString = account.cookie.map(c => `${c.key}=${c.value}`).join('; ');
                
                const response = await axios.get(url, {
                    headers: {
                        'Cookie': cookieString,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                        'Referer': url,
                        'Connection': 'keep-alive'
                    },
                    timeout: 15000,
                    maxRedirects: 5
                });
                
                // 记录成功信息
                result.success = true;
                result.statusCode = response.status;
                result.responseText = extractAllTextFromResponse(response.data);
                result.headers = response.headers;
                
                writeLog(`账号 ${account.name} 签到成功: 状态码=${response.status}, 响应长度=${result.responseText.length}`);
                
            } catch (error) {
                // 记录失败信息
                result.statusCode = error.response?.status || null;
                result.error = error.message;
                
                // 尝试获取错误响应的内容
                if (error.response?.data) {
                    result.responseText = extractAllTextFromResponse(error.response.data);
                    writeLog(`账号 ${account.name} 签到失败: 状态码=${result.statusCode}, 错误响应长度=${result.responseText.length}`);
                } else {
                    writeLog(`账号 ${account.name} 签到失败: ${error.message}`);
                }
            }
            
            return result;
        });

        // 等待所有签到请求完成
        const results = await Promise.all(signinPromises);
        
        // 统计结果
        const successCount = results.filter(r => r.success).length;
        const totalCount = results.length;
        
        writeLog(`签到完成: ${successCount}/${totalCount} 个账号成功`);
        
        // 发送结果给前端
        ws.send(JSON.stringify({
            type: 'signin_result',
            data: {
                success: successCount > 0,
                totalCount: totalCount,
                successCount: successCount,
                results: results
            }
        }));
        
    } catch (error) {
        console.error('处理签到请求失败:', error);
        writeLog(`签到处理失败: ${error.message}`);
        
        ws.send(JSON.stringify({
            type: 'signin_error',
            message: `签到处理失败: ${error.message}`
        }));
    }
}

// 从响应中提取所有文本内容
function extractAllTextFromResponse(response) {
    let textContent = '';
    
    if (typeof response === 'string') {
        textContent = response;
    } else if (response && typeof response.toString === 'function') {
        textContent = response.toString();
    } else {
        textContent = String(response);
    }
    
    // 移除HTML标签，但保留所有文本内容
    const cleanText = textContent
        .replace(/<script[^>]*>.*?<\/script>/gs, '') // 移除脚本
        .replace(/<style[^>]*>.*?<\/style>/gs, '')   // 移除样式
        .replace(/<[^>]*>/g, '')                      // 移除其他HTML标签
        .replace(/\s+/g, ' ')                         // 合并空白字符
        .trim();
    
    // 限制长度但保留更多信息
    return cleanText.substring(0, 1000);
}

// 优雅关闭处理
process.on('SIGINT', () => {
    writeLog('收到关闭信号，正在优雅关闭服务器...');
    
    // 关闭数据库连接
    if (db) {
        db.close();
    }
    
    process.exit(0);
});

process.on('SIGTERM', () => {
    writeLog('收到终止信号，正在优雅关闭服务器...');
    
    // 关闭数据库连接
    if (db) {
        db.close();
    }
    
    process.exit(0);
});





// 删除账号
app.delete('/api/accounts/:id', async (req, res) => {
    try {
        const accountId = req.params.id;
        const { password } = req.body;
        
        writeLog(`删除账号请求: ID=${accountId}`);
        
        // 验证密码
        if (!password) {
            return res.status(400).json({ 
                success: false, 
                message: '需要提供删除密码' 
            });
        }
        
        if (password !== config.security.delete_password) {
            writeLog(`删除账号密码错误: ID=${accountId}`);
            return res.status(401).json({ 
                success: false, 
                message: '删除密码错误' 
            });
        }
        
        // 执行删除
        const result = await db.deleteAccount(accountId);
        
        writeLog(`账号删除成功: ID=${accountId}`);
        
        res.json({ 
            success: true, 
            message: '账号删除成功'
        });
    } catch (error) {
        console.error('删除账号出错:', error);
        writeLog(`删除账号失败: ${error.message}`);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// 硬删除账号（管理员功能）
app.delete('/api/accounts/:id/hard', async (req, res) => {
    try {
        const accountId = req.params.id;
        const { password } = req.body;
        
        writeLog(`开始硬删除账号，ID: ${accountId}`);
        
        // 验证密码
        if (!password) {
            return res.status(400).json({ 
                success: false, 
                message: '需要提供删除密码' 
            });
        }
        
        if (password !== config.security.delete_password) {
            writeLog(`硬删除账号密码错误: ID=${accountId}`);
            return res.status(401).json({ 
                success: false, 
                message: '删除密码错误' 
            });
        }
        
        // 执行硬删除
        const result = await db.hardDeleteAccount(accountId);
        
        writeLog(`账号硬删除成功: ${result.account.name} (UserID: ${result.account.userid})`);
        
        res.json({ 
            success: true, 
            message: `账号 "${result.account.name}" 已彻底删除`,
            data: {
                accountId: result.account.id,
                name: result.account.name,
                userid: result.account.userid
            }
        });
    } catch (error) {
        console.error('硬删除账号出错:', error);
        writeLog(`硬删除账号失败: ${error.message}`);
        
        let statusCode = 500;
        if (error.message.includes('账号不存在')) {
            statusCode = 404;
        }
        
        res.status(statusCode).json({ 
            success: false, 
            message: error.message 
        });
    }
});







// 检查单个账号状态
app.post('/api/accounts/check-status', async (req, res) => {
    try {
        const { accountId } = req.body;
        
        if (!accountId) {
            return res.status(400).json({ 
                success: false, 
                message: '账号ID不能为空' 
            });
        }
        
        // 获取账号信息
        const account = await db.getAccountById(accountId);
        if (!account) {
            return res.status(404).json({ 
                success: false, 
                message: '账号不存在' 
            });
        }
        
        if (!account.cookie) {
            return res.json({ 
                success: true, 
                message: '账号无Cookie',
                status: 0
            });
        }
        
        // 使用新的 userinfo 接口验证Cookie
        const api = new YuketangAPI();
        
        // 先设置Cookie
        const setResult = await api.setCookies(account.cookie);
        if (!setResult.success) {
            console.error('设置Cookie失败:', setResult.message);
            await db.updateAccountStatus(accountId, 0);
            return res.json({ 
                success: true, 
                message: 'Cookie设置失败',
                status: 0
            });
        }
        
        console.log(`检查账号 ${account.name} 的Cookie状态...`);
        const statusResult = await api.checkLoginStatus();
        
        if (statusResult.success) {
            // Cookie有效，更新状态为已登录
            await db.updateAccountStatus(accountId, 1);
            
            res.json({ 
                success: true, 
                message: '账号已登录',
                status: 1,
                userInfo: statusResult.data
            });
        } else {
            // Cookie无效，更新状态为未登录
            await db.updateAccountStatus(accountId, 0);
            
            res.json({ 
                success: true, 
                message: 'Cookie已失效',
                status: 0
            });
        }
        
    } catch (error) {
        console.error('检查账号状态出错:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// 批量检查所有账号状态
app.post('/api/accounts/check-all-status', async (req, res) => {
    try {
        // 获取所有有Cookie的账号
        const accounts = await db.getActiveAccounts();
        
        if (accounts.length === 0) {
            return res.json({ 
                success: true, 
                message: '没有需要检查的账号',
                results: []
            });
        }
        
        console.log(`开始批量检查 ${accounts.length} 个账号的状态...`);
        
        const results = [];
        
        // 并发检查所有账号（限制并发数）
        const concurrencyLimit = 5;
        const chunks = [];
        for (let i = 0; i < accounts.length; i += concurrencyLimit) {
            chunks.push(accounts.slice(i, i + concurrencyLimit));
        }
        
        for (const chunk of chunks) {
            const chunkPromises = chunk.map(async (account) => {
                try {
                    const api = new YuketangAPI();
                    
                    // 先设置Cookie
                    const setResult = await api.setCookies(account.cookie);
                    if (!setResult.success) {
                        console.error(`账号 ${account.name} 设置Cookie失败:`, setResult.message);
                        await db.updateAccountStatus(account.id, 0);
                        return {
                            accountId: account.id,
                            name: account.name,
                            status: 0,
                            message: 'Cookie设置失败'
                        };
                    }
                    
                    console.log(`检查账号 ${account.name} 的Cookie状态...`);
                    const statusResult = await api.checkLoginStatus();
                    
                    if (statusResult.success) {
                        // Cookie有效
                        await db.updateAccountStatus(account.id, 1);
                        results.push({
                            accountId: account.id,
                            name: account.name,
                            status: 1,
                            message: '已登录',
                            userInfo: statusResult.data
                        });
                    } else {
                        // Cookie无效
                        await db.updateAccountStatus(account.id, 0);
                        results.push({
                            accountId: account.id,
                            name: account.name,
                            status: 0,
                            message: 'Cookie已失效'
                        });
                    }
                } catch (error) {
                    // 检查失败
                    console.error(`账号 ${account.name} 检查失败:`, error.message);
                    await db.updateAccountStatus(account.id, 0);
                    results.push({
                        accountId: account.id,
                        name: account.name,
                        status: 0,
                        message: '检查失败'
                    });
                }
            });
            
            // 等待当前批次完成
            await Promise.all(chunkPromises);
            
            // 批次间稍作延迟
            if (chunks.indexOf(chunk) < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        const successCount = results.filter(r => r.status === 1).length;
        const totalCount = results.length;
        
        console.log(`批量检查完成: ${successCount}/${totalCount} 个账号有效`);
        
        res.json({ 
            success: true, 
            message: `检查完成: ${successCount}/${totalCount} 个账号有效`,
            results: results
        });
        
    } catch (error) {
        console.error('批量检查账号状态出错:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// 清除Cookie
app.post('/api/accounts/:id/clear-cookies', async (req, res) => {
    try {
        const accountId = req.params.id;
        
        // 清除账号的Cookie
        await db.updateAccountCookie(accountId, null);
        await db.updateAccountStatus(accountId, 0);
        
        res.json({ 
            success: true, 
            message: 'Cookie已清除' 
        });
    } catch (error) {
        console.error('清除Cookie出错:', error);
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// 启动服务器（默认HTTPS）
let server;

// 每次启动都重新生成SSL证书
console.log(`📋 为IP地址 ${SSL_IP} 生成SSL证书...`);
try {
    // 给脚本添加执行权限
    fs.chmodSync(path.join(__dirname, '../generate-dynamic-cert.sh'), '755');
    // 执行证书生成脚本
    execSync('./generate-dynamic-cert.sh', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
    console.log('✅ SSL证书生成成功');
} catch (error) {
    console.error('❌ SSL证书生成失败:', error.message);
    process.exit(1);
}

// 启动HTTPS服务器
try {
    const options = {
        key: fs.readFileSync(path.join(__dirname, '../ssl/server.key')),
        cert: fs.readFileSync(path.join(__dirname, '../ssl/server.crt'))
    };
    
    server = https.createServer(options, app);
    console.log('🔒 HTTPS模式已启用');
} catch (error) {
    console.error('❌ SSL证书加载失败:', error.message);
    process.exit(1);
}

server.listen(PORT, '0.0.0.0', () => {
    // 强制使用HTTPS
    const protocol = 'https';
    
    console.log(`雨课堂代签到系统启动成功！`);
    console.log(`服务器运行在: ${protocol}://0.0.0.0:${PORT}`);
    console.log(`管理界面: ${protocol}://0.0.0.0:${PORT}/admin.html`);
    
    
    // 获取本机IP地址
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    const results = [];
    
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // 跳过内部地址和非IPv4
            if (net.family === 'IPv4' && !net.internal) {
                results.push(net.address);
            }
        }
    }
    
    if (results.length > 0) {
        console.log('\n其他设备可通过以下IP访问:');
        results.forEach(ip => {
            console.log(`  ${protocol}://${ip}:${PORT}`);
        });
        
        console.log('\n📱 管理提示:');
        console.log('  1. 确保手机和电脑在同一WiFi网络');
        console.log('  2. 访问上述HTTPS地址');
        console.log('  3. 接受安全警告（点击"高级"->"继续访问"）');
    }
    
    // 在HTTP服务器启动后初始化WebSocket
    setupWebSocket(server);
});

module.exports = app;