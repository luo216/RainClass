class ScannerApp {
    constructor() {
        this.video = document.getElementById('video');
        this.errorMessage = document.getElementById('errorMessage');
        this.loading = document.getElementById('loading');
        this.scanner = null;
        this.isScanning = false;
        this.lastScannedUrl = null;
        
        this.init();
    }

    async init() {
        try {
            // 检查浏览器是否支持摄像头
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                this.showError('您的浏览器不支持摄像头功能');
                return;
            }

            // 建立WebSocket连接
            this.connectWebSocket();

            // 直接尝试启动摄像头，让浏览器处理权限请求
            await this.startCamera();
        } catch (error) {
            console.error('摄像头初始化失败:', error);
            this.showError('摄像头启动失败，请检查权限设置');
        }
    }

    // 启动摄像头
    async startCamera() {
        try {
            this.showLoading(true);
            
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment', // 优先使用后置摄像头
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });

            this.video.srcObject = stream;
            
            // 等待视频流准备就绪
            await new Promise((resolve) => {
                this.video.onloadedmetadata = resolve;
            });

            this.showLoading(false);
            
            // 初始化二维码扫描器
            this.initQRScanner();
            
        } catch (error) {
            this.showLoading(false);
            console.error('摄像头启动失败:', error);
            
            if (error.name === 'NotAllowedError') {
                this.showError('摄像头权限被拒绝，请在浏览器设置中允许访问摄像头');
            } else if (error.name === 'NotFoundError') {
                this.showError('未找到摄像头设备');
            } else {
                this.showError('摄像头启动失败: ' + error.message);
            }
        }
    }

    // 初始化二维码扫描器
    initQRScanner() {
        try {
            // 检查QRScanner是否可用
            if (typeof QrScanner === 'undefined') {
                this.showError('二维码扫描库加载失败');
                return;
            }

            console.log('开始初始化QR扫描器...');
            
            this.scanner = new QrScanner(
                this.video,
                result => {
                    console.log('QR扫描器回调触发:', result);
                    this.handleScanResult(result);
                },
                {
                    highlightScanRegion: false,
                    highlightCodeOutline: false,
                    returnDetailedScanResult: true,
                    maxScansPerSecond: 10
                }
            );

            this.scanner.start().then(() => {
                this.isScanning = true;
                console.log('二维码扫描器已启动');
            }).catch(error => {
                console.error('扫描器启动失败:', error);
                this.showError('扫描器启动失败: ' + error.message);
            });
            
        } catch (error) {
            console.error('二维码扫描器初始化失败:', error);
            this.showError('二维码扫描器初始化失败');
        }
    }

    // 处理扫描结果
    handleScanResult(result) {
        console.log('处理扫描结果:', result);
        
        if (!result) {
            console.log('扫描结果为空');
            return;
        }

        // 获取URL数据，支持不同的数据格式
        let url = null;
        if (result.data) {
            url = result.data;
        } else if (typeof result === 'string') {
            url = result;
        } else {
            console.log('无法从扫描结果中提取URL');
            return;
        }

        console.log('扫描到二维码:', url);
        
        // 处理扫描到的URL（processScannedUrl会负责停止扫描）
        this.processScannedUrl(url);
    }

    // 处理扫描到的URL
    async processScannedUrl(url) {
        try {
            this.showLoading(true);
            
            // 验证URL格式
            if (!this.isValidUrl(url)) {
                throw new Error('无效的二维码格式');
            }

            // 显示扫描到的URL
            this.showScannedUrl(url);
            
        } catch (error) {
            this.showLoading(false);
            this.showError('处理二维码失败: ' + error.message);
            
            // 重新开始扫描
            setTimeout(() => {
                this.restartScanning();
            }, 2000);
        }
    }

    // 验证URL格式
    isValidUrl(string) {
        try {
            const url = new URL(string);
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch (_) {
            return false;
        }
    }

    // 显示扫描到的URL
    showScannedUrl(url) {
        console.log('显示扫描结果，URL:', url);
        this.showLoading(false);
        
        // 保存URL到变量
        this.lastScannedUrl = url;
        console.log('URL已保存到变量:', this.lastScannedUrl);
        
        // 停止扫描
        console.log('停止扫描器...');
        this.stopScanning();
        
        // 发送签到请求
        this.sendSigninRequest(url);
    }
    
    // 建立WebSocket连接
    connectWebSocket() {
        const sessionId = 'scanner_session_' + Date.now();
        
        // 关闭现有连接
        if (this.wsConnection) {
            this.wsConnection.close();
        }

        // 保存会话ID
        this.currentSessionId = sessionId;

        // 使用当前页面的host
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        console.log(`连接WebSocket: ${wsUrl}`);
        
        this.wsConnection = new WebSocket(wsUrl);
        
        this.wsConnection.onopen = () => {
            console.log('WebSocket连接已建立');
            
            // 注册会话
            this.wsConnection.send(JSON.stringify({
                type: 'register',
                sessionId: sessionId
            }));
        };
        
        this.wsConnection.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                
                if (message.type === 'signin_result' || message.type === 'signin_error') {
                    this.handleSigninResult(message);
                }
            } catch (error) {
                console.error('WebSocket消息解析错误:', error);
            }
        };
        
        this.wsConnection.onclose = (event) => {
            console.log(`WebSocket连接已关闭，代码: ${event.code}, 原因: ${event.reason}`);
            this.wsConnection = null;
        };
        
        this.wsConnection.onerror = (error) => {
            console.error('WebSocket连接错误:', error);
        };
    }

    // 发送签到请求
    async sendSigninRequest(url) {
        try {
            console.log('发送签到请求:', url);
            this.showLoading(true);
            
            // 如果没有WebSocket连接，先建立连接
            if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
                console.log('WebSocket未连接，先建立连接...');
                this.connectWebSocket();
                
                // 等待连接建立
                await new Promise((resolve) => {
                    const checkConnection = () => {
                        if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
                            resolve();
                        } else {
                            setTimeout(checkConnection, 100);
                        }
                    };
                    checkConnection();
                });
            }
            
            // 发送签到请求
            this.wsConnection.send(JSON.stringify({
                type: 'signin',
                url: url,
                sessionId: this.currentSessionId || 'scanner_session'
            }));
            
        } catch (error) {
            console.error('发送签到请求失败:', error);
            this.showError('发送签到请求失败: ' + error.message);
            this.showLoading(false);
        }
    }
    
    // 处理签到结果
    handleSigninResult(data) {
        console.log('收到签到结果:', data);
        this.showLoading(false);
        
        if (data.type === 'signin_result') {
            const { successCount, totalCount, results } = data.data;
            
            // 创建结果显示界面
            const resultDiv = document.createElement('div');
            resultDiv.className = 'result-modal';
            resultDiv.innerHTML = `
                <div class="result-content">
                    <div class="success-icon">${successCount > 0 ? '✓' : '✗'}</div>
                    <p class="success-text">签到完成</p>
                    <div class="signin-summary">
                        <p>成功: ${successCount}/${totalCount} 个账号</p>
                    </div>
                    <div class="results-list">
                        ${results.map(result => `
                            <div class="result-item ${result.success ? 'success' : 'error'}">
                                <div class="account-info">
                                    <span class="account-name">${result.name}</span>
                                    <span class="status-code">状态码: ${result.statusCode || 'N/A'}</span>
                                </div>
                                <div class="response-content">
                                    <div class="response-label">响应内容:</div>
                                    <div class="response-text">${this.escapeHtml(result.responseText || result.error || '无响应')}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <button class="rescan-btn" onclick="window.scannerApp.restartScanning(); this.parentElement.parentElement.remove();">
                        重新扫码
                    </button>
                </div>
            `;
            
            // 添加到页面
            document.body.appendChild(resultDiv);
        } else if (data.type === 'signin_error') {
            this.showError('签到失败: ' + data.message);
        }
    }
    
    // 获取最后扫描的URL
    getLastScannedUrl() {
        return this.lastScannedUrl;
    }

    
    
    // HTML转义
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    

    // 停止扫描
    stopScanning() {
        if (this.scanner && this.isScanning) {
            this.scanner.stop();
            this.isScanning = false;
        }
    }

    // 重新开始扫描
    async restartScanning() {
        this.showLoading(false);
        this.hideError();
        
        if (this.scanner && !this.isScanning) {
            try {
                console.log('重新启动扫描器...');
                await this.scanner.start();
                this.isScanning = true;
                console.log('扫描器重新启动成功');
            } catch (error) {
                console.error('扫描器重新启动失败:', error);
                this.showError('扫描器重新启动失败: ' + error.message);
            }
        } else if (!this.scanner) {
            console.log('扫描器不存在，重新初始化...');
            await this.initQRScanner();
        }
    }

    // 显示加载动画
    showLoading(show) {
        this.loading.style.display = show ? 'block' : 'none';
    }

    // 显示错误信息
    showError(message) {
        this.errorMessage.textContent = message;
        this.errorMessage.style.display = 'block';
        
        // 3秒后自动隐藏
        setTimeout(() => {
            this.hideError();
        }, 3000);
    }

    // 隐藏错误信息
    hideError() {
        this.errorMessage.style.display = 'none';
    }

    // 显示成功信息
    showSuccess(message) {
        this.errorMessage.textContent = message;
        this.errorMessage.style.background = 'rgba(52, 199, 89, 0.9)';
        this.errorMessage.style.display = 'block';
    }

    

    // 清理资源
    destroy() {
        this.stopScanning();
        
        // 停止摄像头流
        if (this.video.srcObject) {
            const tracks = this.video.srcObject.getTracks();
            tracks.forEach(track => track.stop());
        }
    }
}



// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    window.scannerApp = new ScannerApp();
    
    // 页面卸载时清理资源
    window.addEventListener('beforeunload', () => {
        if (window.scannerApp) {
            window.scannerApp.destroy();
        }
    });
});

// 处理页面可见性变化
document.addEventListener('visibilitychange', () => {
    if (window.scannerApp) {
        if (document.hidden) {
            // 页面隐藏时停止扫描以节省资源
            window.scannerApp.stopScanning();
        } else {
            // 页面显示时恢复扫描
            window.scannerApp.restartScanning();
        }
    }
});