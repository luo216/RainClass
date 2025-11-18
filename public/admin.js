class AdminApp {
    constructor() {
        console.log('=== AdminApp 初始化 - 简化版 ===');
        this.accounts = [];
        this.wsConnection = null;
        this.currentSessionId = null;
        this.currentCookies = null;
        this.currentUserInfo = null;
        this.init();
    }

    init() {
        this.loadAccounts();
        this.setupModalListeners();
        this.checkAllAccountsStatus();
    }

    setupModalListeners() {
        // 模态框事件 - 自动触发扫码登录
        const addAccountModal = document.getElementById('addAccountModal');
        if (addAccountModal) {
            addAccountModal.addEventListener('show.bs.modal', () => {
                console.log('模态框打开，自动开始扫码登录');
                this.startScanLogin();
            });
            
            addAccountModal.addEventListener('hidden.bs.modal', () => {
                console.log('模态框关闭，清理扫码登录');
                this.cancelScanLogin();
            });
        }
    }

    // 加载账号列表
    async loadAccounts() {
        try {
            const response = await fetch('/api/accounts');
            const result = await response.json();

            if (result.success) {
                this.accounts = result.data;
                console.log('加载的账号数据:', this.accounts);
                this.displayAccounts();
            } else {
                this.showMessage('加载账号列表失败', 'error');
            }
        } catch (error) {
            console.error('加载账号失败:', error);
            this.showMessage('加载账号列表失败', 'error');
        }
    }

    // 显示账号列表
    displayAccounts() {
        const container = document.getElementById('accounts-container');
        
        if (!container) return;

        if (this.accounts.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-inbox"></i>
                    <h5>暂无账号</h5>
                    <p>点击"添加账号"按钮，通过微信扫码登录添加雨课堂账号</p>
                </div>
            `;
            return;
        }

        const tableHtml = `
            <div class="table-responsive">
                <table class="table">
                    <thead>
                        <tr>
                            <th>姓名</th>
                            <th>UserID</th>
                            <th>状态</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.accounts.map(account => this.createAccountRow(account)).join('')}
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = tableHtml;
    }

    // 创建账号行
    createAccountRow(account) {
        // 使用数据库中的status字段来判断状态
        const statusBadge = account.status === 1 
            ? '<span class="badge badge-success">已登录</span>'
            : '<span class="badge badge-danger">未登录</span>';
        
        return `
            <tr>
                <td>
                    <strong>${account.name}</strong>
                </td>
                <td>
                    <code>${account.uid || account.userid || '-'}</code>
                </td>
                <td>
                    ${statusBadge}
                </td>
                <td>
                    <button class="btn btn-outline btn-sm me-2" onclick="refreshAccount(${account.id})" title="刷新状态">
                        <i class="bi bi-arrow-clockwise"></i>
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="deleteAccount(${account.id}, '${account.name}')" title="删除账号">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }

    // 开始扫码登录流程
    async startScanLogin() {
        try {
            console.log('开始扫码登录流程...');
            
            // 重置状态
            this.resetModalState('loading');
            
            // 调用后端扫码登录API
            const response = await fetch('/api/scan-login/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            const result = await response.json();
            console.log('扫码登录响应:', result);

            if (result.success) {
                this.currentSessionId = result.data.sessionId;
                
                // 建立WebSocket连接
                this.connectWebSocket(this.currentSessionId);
                
                // 显示二维码
                this.resetModalState('scan');
                this.displayQRCode(result.data.qrCodeUrl, result.data.qrCodeUrl);
            } else {
                this.showMessage(result.message || '获取二维码失败', 'error');
                this.resetModalState('error');
            }
        } catch (error) {
            console.error('扫码登录失败:', error);
            this.showMessage('网络错误或处理失败', 'error');
            this.resetModalState('error');
        }
    }

    // 建立WebSocket连接
    connectWebSocket(sessionId) {
        // 关闭现有连接
        if (this.wsConnection) {
            this.wsConnection.close();
        }

        // 使用当前页面的host而不是localhost
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
                this.handleWebSocketMessage(message);
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
    
    // 处理WebSocket消息
    handleWebSocketMessage(message) {
        console.log('收到WebSocket消息:', message);
        
        switch (message.type) {
            case 'registered':
                console.log('WebSocket会话注册成功:', message.sessionId);
                break;
                
            case 'login_success':
                this.handleLoginSuccess(message.data);
                break;
                
            case 'qr_update':
                this.handleQRCodeUpdate(message.data);
                break;
                
            case 'status_update':
                this.handleStatusUpdate(message.data);
                break;
                
            default:
                console.log('未知消息类型:', message.type);
        }
    }
    
    // 处理登录成功
    handleLoginSuccess(data) {
        console.log('WebSocket收到登录成功消息:', data);
        
        // 停止轮询
        if (this.scanCheckInterval) {
            clearInterval(this.scanCheckInterval);
            this.scanCheckInterval = null;
        }
        
        if (data.step === 'auto_save') {
            // 自动保存模式，直接保存账号
            this.currentCookies = data.cookies;
            this.currentUserInfo = data.userInfo;
            this.autoSaveAccount();
        } else {
            // 手动输入模式（保留兼容性）
            this.currentCookies = data.cookies;
            this.showNameInputDialog();
        }
    }

    // 重置模态框状态
    resetModalState(state) {
        const loadingQr = document.getElementById('loading-qr');
        const scanQr = document.getElementById('scan-qr');
        const loadingStatus = document.getElementById('loading-status');
        
        // 隐藏所有状态（检查元素是否存在）
        if (loadingQr) loadingQr.style.display = 'none';
        if (scanQr) scanQr.style.display = 'none';
        
        // 显示对应状态
        switch (state) {
            case 'loading':
                if (loadingQr) loadingQr.style.display = 'block';
                if (loadingStatus) loadingStatus.textContent = '正在获取二维码...';
                break;
            case 'scan':
                if (scanQr) scanQr.style.display = 'block';
                break;
            case 'success':
                // success状态不在这里处理，由其他函数处理
                break;
            case 'error':
                if (loadingQr) loadingQr.style.display = 'block';
                if (loadingStatus) loadingStatus.textContent = '获取二维码失败，请重试';
                break;
            case 'custom':
                // 自定义状态，不显示任何默认内容
                break;
        }
    }

    // 显示二维码
    displayQRCode(qrCodeUrl, qrCodeUrlInput) {
        const qrContainer = document.getElementById('qr-code-container');
        const qrUrlInputElement = document.getElementById('qr-code-url');
        
        if (qrContainer) {
            qrContainer.innerHTML = `
                <img src="${qrCodeUrl}" style="max-width: 200px; border-radius: 8px;" alt="微信登录二维码">
            `;
        }
        
        if (qrUrlInputElement) {
            qrUrlInputElement.value = qrCodeUrlInput;
        }
    }

    // 处理二维码更新
    handleQRCodeUpdate(data) {
        console.log('WebSocket收到二维码更新:', data);
        
        if (data.qrCodeUrl) {
            this.displayQRCode(data.qrCodeUrl, data.qrCodeUrl);
        }
        
        // 更新状态显示
        const statusElement = document.getElementById('scan-status');
        if (statusElement && data.message) {
            statusElement.textContent = data.message;
        }
    }
    
    // 处理状态更新
    handleStatusUpdate(data) {
        console.log('WebSocket收到状态更新:', data);
        
        const statusElement = document.getElementById('scan-status');
        if (statusElement && data.message) {
            statusElement.textContent = data.message;
        }
    }

    // 显示姓名输入对话框（保留兼容性）
    showNameInputDialog() {
        // 隐藏二维码界面
        this.resetModalState('custom');
        
        // 创建自定义输入界面
        const scanContainer = document.getElementById('scan-login-container');
        scanContainer.innerHTML = `
            <div class="text-center">
                <div style="font-size: 4rem; margin-bottom: 1rem;">✅</div>
                <h5 class="text-success">登录成功！</h5>
                <p class="text-muted">请输入您的姓名以保存账号</p>
                <div class="mb-3">
                    <input type="text" class="form-control" id="login-name-input" placeholder="请输入姓名" style="max-width: 300px; margin: 0 auto;">
                    <div class="form-text">用于识别账号持有者</div>
                </div>
                <div class="mt-3">
                    <button class="btn-custom btn-success-custom" onclick="saveScanLoginAccount()">
                        <span>✅</span> 保存账号
                    </button>
                    <button class="btn-custom btn-danger-custom ms-2" onclick="cancelScanLogin()">
                        <span>❌</span> 取消
                    </button>
                </div>
            </div>
        `;
        
        // 自动聚焦到输入框
        setTimeout(() => {
            const nameInput = document.getElementById('login-name-input');
            if (nameInput) {
                nameInput.focus();
            }
        }, 100);
    }

    // 保存扫码登录账号（保留兼容性）
    async saveScanLoginAccount() {
        const nameInput = document.getElementById('login-name-input');
        if (!nameInput) {
            this.showMessage('输入框未找到', 'error');
            return;
        }
        const name = nameInput.value.trim();
        
        if (!name) {
            this.showMessage('请输入姓名', 'warning');
            return;
        }

        // 检查用户名是否重复
        const isNameDuplicate = this.accounts.some(account => account.name === name);
        if (isNameDuplicate) {
            this.showMessage('该姓名已存在，请使用不同的姓名', 'warning');
            return;
        }

        try {
            const response = await fetch('/api/scan-login/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    sessionId: this.currentSessionId,
                    name: name,
                    cookies: this.currentCookies
                })
            });

            const result = await response.json();
            console.log('保存扫码登录账号响应:', result);

            if (result.success) {
                this.showMessage('账号添加成功', 'success');
                
                // 3秒后自动关闭模态框
                setTimeout(() => {
                    const modal = bootstrap.Modal.getInstance(document.getElementById('addAccountModal'));
                    if (modal) modal.hide();
                }, 3000);
                
                this.loadAccounts();
            } else {
                this.showMessage(result.message || '保存账号失败', 'error');
            }
        } catch (error) {
            console.error('保存扫码登录账号失败:', error);
            this.showMessage('网络错误或处理失败', 'error');
        }
    }

    // 取消扫码登录
    cancelScanLogin() {
        console.log('取消扫码登录，清理资源...');
        
        // 清理定时器
        if (this.scanCheckInterval) {
            clearInterval(this.scanCheckInterval);
            this.scanCheckInterval = null;
        }
        
        // 关闭WebSocket连接
        if (this.wsConnection) {
            this.wsConnection.close();
            this.wsConnection = null;
        }
        
        // 清理会话
        this.currentSessionId = null;
        this.currentCookies = null;
        this.currentUserInfo = null;
        
        // 关闭模态框
        const modal = bootstrap.Modal.getInstance(document.getElementById('addAccountModal'));
        if (modal) {
            // 先移除焦点，避免无障碍警告
            if (document.activeElement) {
                document.activeElement.blur();
            }
            modal.hide();
        }
    }

    // 自动保存账号
    async autoSaveAccount() {
        const userInfo = this.currentUserInfo;
        
        if (!userInfo || !userInfo.name || !userInfo.userId) {
            this.showMessage('用户信息不完整，保存失败', 'error');
            return;
        }

        try {
            const response = await fetch('/api/scan-login/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    sessionId: this.currentSessionId,
                    name: userInfo.name,
                    userId: userInfo.userId,
                    cookies: this.currentCookies
                })
            });

            const result = await response.json();
            console.log('自动保存账号响应:', result);

            if (result.success) {
                this.showAutoSaveSuccess(userInfo);
                this.loadAccounts();
            } else {
                this.showMessage(result.message || '保存账号失败', 'error');
            }
        } catch (error) {
            console.error('自动保存账号失败:', error);
            this.showMessage('网络错误或处理失败', 'error');
        }
    }

    // 显示自动保存成功界面
    showAutoSaveSuccess(userInfo) {
        // 显示成功提示
        this.showMessage(`账号添加成功: ${userInfo.name}`, 'success');
        
        // 3秒后自动关闭模态框
        setTimeout(() => {
            const modal = bootstrap.Modal.getInstance(document.getElementById('addAccountModal'));
            if (modal) {
                // 先移除焦点，避免无障碍警告
                if (document.activeElement) {
                    document.activeElement.blur();
                }
                modal.hide();
            }
        }, 3000);
    }

    // 复制二维码URL
    copyQrUrl() {
        const qrUrlInput = document.getElementById('qr-code-url');
        if (qrUrlInput) {
            qrUrlInput.select();
            qrUrlInput.setSelectionRange(0, 99999);
            
            try {
                document.execCommand('copy');
                this.showMessage('二维码链接已复制到剪贴板', 'success');
            } catch (err) {
                console.error('复制失败:', err);
                this.showMessage('复制失败，请手动复制', 'error');
            }
        }
    }

    // 刷新账号状态
    async refreshAccount(accountId) {
        try {
            console.log(`刷新账号状态: ${accountId}`);
            
            // 获取账号信息
            const account = this.accounts.find(acc => acc.id === accountId);
            if (!account) {
                this.showMessage('账号不存在', 'error');
                return;
            }
            
            // 检查是否有Cookie
            if (!account.cookie) {
                this.showMessage('账号无Cookie，无法刷新状态', 'warning');
                return;
            }
            
            // 显示刷新中状态
            this.showMessage('正在检查账号状态...', 'info');
            
            // 调用后端API检查Cookie有效性
            const response = await fetch('/api/accounts/check-status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    accountId: accountId
                })
            });
            
            const result = await response.json();
            console.log('检查状态响应:', result);
            
            if (result.success) {
                this.showMessage(`账号状态已更新: ${result.message}`, 'success');
                this.loadAccounts();
            } else {
                this.showMessage(result.message || '检查状态失败', 'error');
            }
        } catch (error) {
            console.error('刷新账号失败:', error);
            this.showMessage('刷新账号失败', 'error');
        }
    }

    // 删除账号
    async deleteAccount(accountId, accountName) {
        // 显示密码输入对话框
        const password = await this.showPasswordDialog(`删除账号 "${accountName}"`, '请输入删除密码以确认操作:');
        
        if (!password) {
            return;
        }

        try {
            console.log(`删除账号: ${accountId} - ${accountName}`);
            
            const response = await fetch(`/api/accounts/${accountId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    password: password 
                })
            });

            const result = await response.json();
            
            if (result.success) {
                this.showMessage(`账号 "${accountName}" 删除成功`, 'success');
                this.loadAccounts();
            } else {
                this.showMessage(result.message || '删除账号失败', 'error');
            }
        } catch (error) {
            console.error('删除账号失败:', error);
            this.showMessage('删除账号失败', 'error');
        }
    }

    // 显示密码输入对话框
    showPasswordDialog(title, message) {
        // 创建模态框HTML
        const modalHtml = `
            <div class="modal fade" id="passwordModal" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${title}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <p>${message}</p>
                            <div class="mb-3">
                                <label for="passwordInput" class="form-label">密码</label>
                                <input type="password" class="form-control" id="passwordInput" placeholder="请输入密码">
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">取消</button>
                            <button type="button" class="btn btn-danger" id="confirmPasswordBtn">确认</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // 移除已存在的密码模态框
        const existingModal = document.getElementById('passwordModal');
        if (existingModal) {
            existingModal.remove();
        }

        // 添加到页面
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // 显示模态框
        const modal = new bootstrap.Modal(document.getElementById('passwordModal'));
        modal.show();

        // 返回Promise来获取密码
        return new Promise((resolve) => {
            const passwordInput = document.getElementById('passwordInput');
            const confirmBtn = document.getElementById('confirmPasswordBtn');
            
            // 自动聚焦到密码输入框
            setTimeout(() => {
                passwordInput.focus();
            }, 200);

            // 确认按钮点击事件
            confirmBtn.addEventListener('click', () => {
                const password = passwordInput.value.trim();
                modal.hide();
                resolve(password);
            });

            // 模态框隐藏事件（取消操作）
            document.getElementById('passwordModal').addEventListener('hidden.bs.modal', () => {
                resolve(null);
            }, { once: true });

            // 回车键确认
            passwordInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const password = passwordInput.value.trim();
                    modal.hide();
                    resolve(password);
                }
            });
        });
    }

    // 检查所有账号状态
    async checkAllAccountsStatus() {
        try {
            console.log('开始检查所有账号状态...');
            
            // 显示检查中提示
            this.showMessage('正在检查所有账号状态，请稍候...', 'info');
            
            const response = await fetch('/api/accounts/check-all-status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            const result = await response.json();
            console.log('批量检查状态响应:', result);

            if (result.success) {
                const { results } = result;
                const validCount = results.filter(r => r.status === 1).length;
                const totalCount = results.length;
                
                this.showMessage(`状态检查完成: ${validCount}/${totalCount} 个账号有效`, 'success');
                
                // 重新加载账号列表以更新状态显示
                this.loadAccounts();
            } else {
                this.showMessage(result.message || '批量检查状态失败', 'error');
            }
        } catch (error) {
            console.error('批量检查账号状态失败:', error);
            this.showMessage('批量检查账号状态失败', 'error');
        }
    }

    // 显示消息
    showMessage(message, type) {
        // 创建消息元素
        const messageDiv = document.createElement('div');
        messageDiv.className = `alert alert-${type === 'error' ? 'danger' : type} alert-dismissible fade show position-fixed`;
        messageDiv.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px; max-width: 400px;';
        messageDiv.innerHTML = `
            <div class="d-flex align-items-center">
                <i class="bi ${type === 'success' ? 'bi-check-circle' : type === 'error' ? 'bi-x-circle' : 'bi-info-circle'} me-2"></i>
                <span>${message}</span>
            </div>
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;

        document.body.appendChild(messageDiv);

        // 3秒后自动移除
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, 3000);
    }
}

// 全局函数供HTML调用
function refreshAccount(accountId) {
    window.adminApp.refreshAccount(accountId);
}

function deleteAccount(accountId, accountName) {
    window.adminApp.deleteAccount(accountId, accountName);
}

function copyQrUrl() {
    window.adminApp.copyQrUrl();
}

function cancelScanLogin() {
    window.adminApp.cancelScanLogin();
}

function saveScanLoginAccount() {
    window.adminApp.saveScanLoginAccount();
}

function checkAllAccountsStatus() {
    window.adminApp.checkAllAccountsStatus();
}

function openScanner() {
    window.open('/scanner', '_blank');
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    window.adminApp = new AdminApp();
});