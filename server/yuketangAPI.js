const axios = require('axios');
const { CookieJar, Cookie } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// 日志写入函数
function writeLog(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] YuketangAPI: ${message}`;
    console.log(logMessage);
    
    // 写入到日志文件
    fs.appendFile(path.join(__dirname, '../logs/server.log'), logMessage + '\n', (err) => {
        if (err) {
            console.error('写入日志文件失败:', err);
        }
    });
}

class YuketangAPI {
    constructor() {
        this.cookieJar = new CookieJar();
        this.client = wrapper(axios.create({
            jar: this.cookieJar,
            withCredentials: true,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache'
            },
            timeout: 30000
        }));
        
        this.loginSuccessCallback = null;
        this.wsConnection = null;
        this.qrExpireTimer = null;
    }

    // 设置登录成功回调
    setLoginSuccessCallback(callback) {
        this.loginSuccessCallback = callback;
    }

    // 获取微信登录二维码
    async getWeChatQRCode() {
        try {
            console.log('开始通过正确的流程获取雨课堂微信登录二维码...');

            // 步骤1: 访问主页
            console.log('步骤1: 访问主页...');
            await this.client.get('https://www.yuketang.cn/v2/web/index');

            // 步骤2: 加载PC JS
            console.log('步骤2: 加载PC JS...');
            await this.client.get('https://fe-static-yuketang.yuketang.cn/fe/static/web/1.2.22/js/pc.70021f83.js');

            // 步骤3: 访问web页面
            console.log('步骤3: 访问web页面...');
            await this.client.get('https://www.yuketang.cn/web?next=/v2/web/index&type=3');

            // 步骤4: 加载登录JS
            console.log('步骤4: 加载登录JS...');
            await this.client.get('https://fe-static-yuketang.yuketang.cn/fe/static/vue/2.2.648/login.js');

            return new Promise((resolve, reject) => {
                // 步骤3: 建立WebSocket连接
                console.log('步骤3: 建立WebSocket连接...');
                
                // 获取当前Cookie用于WebSocket连接
                const cookies = this.cookieJar.getCookiesSync('https://www.yuketang.cn');
                const cookieString = cookies.map(cookie => `${cookie.key}=${cookie.value}`).join('; ');
                
                const wsUrl = 'wss://www.yuketang.cn/wsapp/';
                
                this.wsConnection = new WebSocket(wsUrl);
                
                // 设置3分钟过期，但不关闭连接，等待登录
                this.qrExpireTimer = setTimeout(() => {
                    if (this.wsConnection) {
                        this.wsConnection.close();
                        this.wsConnection = null;
                    }
                }, 180000);
                
                let qrReceived = false;
                
                this.wsConnection.on('open', () => {
                    console.log('WebSocket连接已建立');
                    // 发送登录请求
                    this.wsConnection.send(JSON.stringify({
                        "op": "requestlogin",
                        "role": "web",
                        "version": 1.4,
                        "type": "qrcode",
                        "from": "web"
                    }));
                });
                
                this.wsConnection.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        console.log('收到WebSocket消息:', message);
                        
                        if (message.op === 'requestlogin' && message.ticket && !qrReceived) {
                            qrReceived = true;
                            
                            // 保存loginid供后续使用
                            this.currentLoginId = message.loginid;
                            
                            resolve({
                                success: true,
                                data: {
                                    loginid: message.loginid,
                                    qrCodeUrl: message.ticket,
                                    qrcode: message.qrcode,
                                    expire_seconds: message.expire_seconds
                                }
                            });
                            
                            // 不要关闭WebSocket，继续等待登录消息
                        } else if (message.op === 'loginsuccess') {
                            console.log('收到登录成功消息:', JSON.stringify(message, null, 2));
                            writeLog(`用户登录成功: ${message.Name} (ID: ${message.UserID})`);
                            
                            // 发送pc/web_login请求获取Cookie
                            if (message.UserID && message.Auth) {
                                console.log(`准备发送pc/web_login请求: UserID=${message.UserID}, Auth=${message.Auth}`);
                                this.sendPcWebLogin(message.UserID, message.Auth);
                            } else {
                                console.error('缺少UserID或Auth参数');
                                writeLog('缺少UserID或Auth参数');
                            }
                        }
                    } catch (error) {
                        console.error('WebSocket消息解析错误:', error);
                    }
                });
                
                this.wsConnection.on('error', (error) => {
                    console.error('WebSocket连接错误:', error);
                    reject({
                        success: false,
                        message: `WebSocket连接失败: ${error.message}`
                    });
                });
                
                this.wsConnection.on('close', () => {
                    this.wsConnection = null;
                    if (this.qrExpireTimer) {
                        clearTimeout(this.qrExpireTimer);
                        this.qrExpireTimer = null;
                    }
                });
            });
            
        } catch (error) {
            writeLog(`获取二维码失败: ${error.message}`);
            return {
                success: false,
                message: `获取二维码失败: ${error.message}`
            };
        }
    }

    // 发送pc/web_login请求
    async sendPcWebLogin(userId, auth) {
        try {
            // 使用原生axios发送请求，确保正确的格式
            const directAxios = require('axios');
            
            // 获取当前的Cookie
            const currentCookies = this.cookieJar.getCookiesSync('https://www.yuketang.cn');
            const cookieString = currentCookies.map(c => `${c.key}=${c.value}`).join('; ');
            
            const response = await directAxios.post('https://www.yuketang.cn/pc/web_login', 
                `{"UserID":${userId},"Auth":"${auth}"}`, 
                {
                    headers: {
                        'Cookie': cookieString,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'X-Requested-With': 'XMLHttpRequest',
                        'Referer': 'https://www.yuketang.cn/web',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.205 Safari/537.36',
                        'Accept': 'text/plain',
                        'Origin': 'https://www.yuketang.cn',
                        'Sec-Ch-Ua-Platform': '"Windows"',
                        'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="131", "Google Chrome";v="131"',
                        'Sec-Ch-Ua-Mobile': '?0',
                        'Sec-Fetch-Site': 'same-origin',
                        'Sec-Fetch-Mode': 'cors',
                        'Sec-Fetch-Dest': 'empty',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7'
                    },
                    timeout: 10000
                }
            );
            
            if (response.data && response.data.success) {
                // 获取响应中的Cookie
                const setCookieHeader = response.headers['set-cookie'];
                if (setCookieHeader) {
                    // 解析并保存Cookie
                    for (const cookieStr of setCookieHeader) {
                        const cookieObj = Cookie.parse(cookieStr);
                        if (cookieObj) {
                            this.cookieJar.setCookieSync(cookieObj, 'https://www.yuketang.cn');
                        }
                    }
                }
                
                // 获取所有Cookie
                const cookies = this.cookieJar.getCookiesSync('https://www.yuketang.cn');
                
                // 触发登录成功事件
                this.triggerLoginSuccess({
                    UserID: userId,
                    Name: '张鸿健' // 从之前的消息中获取
                }, true, cookies, response.data);
            }
        } catch (error) {
            writeLog(`pc/web_login请求失败: ${error.message}`);
        }
    }

    // 验证Cookie
    async validateCookies() {
        try {
            const response = await this.client.get('https://www.yuketang.cn/v2/api/web/userinfo');
            return response.data && response.data.data;
        } catch (error) {
            return false;
        }
    }

    // 生成登录ID
    generateLoginId() {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        return `login_${timestamp}_${random}`;
    }

    // 关闭WebSocket连接
    closeWebSocketConnection() {
        if (this.wsConnection) {
            this.wsConnection.close();
            this.wsConnection = null;
        }
        if (this.qrExpireTimer) {
            clearTimeout(this.qrExpireTimer);
            this.qrExpireTimer = null;
        }
    }

    // 设置Cookie
    async setCookies(cookies) {
        try {
            // 清除现有Cookie
            this.cookieJar = new CookieJar();
            this.client.defaults.jar = this.cookieJar;
            
            // 设置新的Cookie
            for (const cookie of cookies) {
                const cookieObj = Cookie.parse(`${cookie.key}=${cookie.value}`);
                if (cookieObj) {
                    this.cookieJar.setCookieSync(cookieObj, 'https://www.yuketang.cn');
                }
            }
            
            return { success: true };
        } catch (error) {
            return { 
                success: false, 
                message: `设置Cookie失败: ${error.message}` 
            };
        }
    }

    // 检查登录状态
    async checkLoginStatus() {
        try {
            // 获取当前Cookie
            const currentCookies = this.cookieJar.getCookiesSync('https://www.yuketang.cn');
            
            if (currentCookies.length === 0) {
                return {
                    success: false,
                    message: '没有找到Cookie'
                };
            }
            
            // 手动构建Cookie字符串
            const cookieString = currentCookies.map(c => `${c.key}=${c.value}`).join('; ');
            const requestHeaders = {
                'Cookie': cookieString,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Referer': 'https://www.yuketang.cn/',
                'X-Requested-With': 'XMLHttpRequest'
            };
            
            // 使用原生axios发送请求（不使用cookie jar）
            const directAxios = require('axios');
            const response = await directAxios.get('https://www.yuketang.cn/v2/api/web/userinfo', {
                headers: requestHeaders,
                timeout: 10000 // 10秒超时
            });
            
            if (response.data && response.data.data) {
                return {
                    success: true,
                    data: {
                        userId: response.data.data.id,
                        name: response.data.data.name,
                        school: response.data.data.school_name,
                        department: response.data.data.department_name
                    }
                };
            } else {
                return {
                    success: false,
                    message: '响应格式异常'
                };
            }
            
        } catch (error) {
            if (error.response && error.response.status === 401) {
                return {
                    success: false,
                    message: 'Cookie已失效'
                };
            } else if (error.code === 'ECONNABORTED') {
                return {
                    success: false,
                    message: '请求超时'
                };
            } else {
                writeLog('❌ 请求失败，状态码:', error.response.status);
                return {
                    success: false,
                    message: `检查状态失败: ${error.message}`
                };
            }
        }
    }

    // 触发登录成功事件
    triggerLoginSuccess(message, autoSave = false, cookies = null, additionalData = null) {
        if (this.loginSuccessCallback) {
            this.loginSuccessCallback({
                success: true,
                data: {
                    userId: message.UserID,
                    name: message.Name,
                    cookies: cookies || this.cookieJar.getCookiesSync('https://www.yuketang.cn'),
                    autoSave: autoSave,
                    additionalData: additionalData
                }
            });
        }
    }
}

module.exports = YuketangAPI;