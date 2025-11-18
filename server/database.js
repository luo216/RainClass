const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');

class Database {
    constructor() {
        // 确保logs目录存在
        const logsDir = path.join(__dirname, '../logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
            console.log('创建logs目录:', logsDir);
        }
        
        const dbPath = path.join(__dirname, '../logs/rainclass.db');
        console.log('数据库路径:', dbPath);
        
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('数据库连接失败:', err.message);
                throw err;
            } else {
                console.log('数据库连接成功');
                this.init();
            }
        });
    }

    init() {
        this.db.serialize(() => {
            // 创建账号表 - 极简版本
            this.db.run(`
                CREATE TABLE IF NOT EXISTS accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    uid TEXT NOT NULL,
                    name TEXT NOT NULL,
                    status INTEGER DEFAULT 0,
                    cookie TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            console.log('数据库初始化完成');
        });
    }

    // 添加账号
    addAccount(uid, name, cookie, status = 0) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO accounts (uid, name, status, cookie) VALUES (?, ?, ?, ?)',
                [uid, name, status, cookie ? JSON.stringify(cookie) : null],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ 
                            id: this.lastID, 
                            uid, 
                            name,
                            status: status,
                            cookie: cookie
                        });
                    }
                }
            );
        });
    }

    // 更新账号状态
    updateAccountStatus(accountId, status) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'UPDATE accounts SET status = ? WHERE id = ?',
                [status, accountId],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ updated: this.changes });
                    }
                }
            );
        });
    }

    // 更新账号Cookie
    updateAccountCookie(accountId, cookie) {
        return new Promise((resolve, reject) => {
            const cookieJson = cookie ? JSON.stringify(cookie) : null;
            this.db.run(
                'UPDATE accounts SET cookie = ? WHERE id = ?',
                [cookieJson, accountId],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ updated: this.changes });
                    }
                }
            );
        });
    }

    // 获取所有账号
    getAllAccounts() {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM accounts ORDER BY created_at DESC',
                [],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        const accounts = rows.map(row => ({
                            ...row,
                            cookie: row.cookie ? JSON.parse(row.cookie) : null
                        }));
                        resolve(accounts);
                    }
                }
            );
        });
    }

    // 根据UID查找账号
    getAccountByUid(uid) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM accounts WHERE uid = ?',
                [uid],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        if (row) {
                            resolve({
                                ...row,
                                cookie: row.cookie ? JSON.parse(row.cookie) : null
                            });
                        } else {
                            resolve(null);
                        }
                    }
                }
            );
        });
    }

    // 根据ID查找账号
    getAccountById(id) {
        return new Promise((resolve, reject) => {
            this.db.get(
                'SELECT * FROM accounts WHERE id = ?',
                [id],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        if (row) {
                            resolve({
                                ...row,
                                cookie: row.cookie ? JSON.parse(row.cookie) : null
                            });
                        } else {
                            resolve(null);
                        }
                    }
                }
            );
        });
    }

    // 获取所有活跃账号（有cookie的账号）
    getActiveAccounts() {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT * FROM accounts WHERE cookie IS NOT NULL AND cookie != "" ORDER BY created_at DESC',
                [],
                (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        const accounts = rows.map(row => ({
                            ...row,
                            cookie: row.cookie ? JSON.parse(row.cookie) : null
                        }));
                        resolve(accounts);
                    }
                }
            );
        });
    }

    // 删除账号
    deleteAccount(accountId) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'DELETE FROM accounts WHERE id = ?',
                [accountId],
                function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ deleted: this.changes });
                    }
                }
            );
        });
    }

    

    // 关闭数据库连接
    close() {
        this.db.close();
    }
}

module.exports = Database;