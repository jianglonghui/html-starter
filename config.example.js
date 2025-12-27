/**
 * API 配置文件示例
 * 复制此文件为 config.js 并填入你的配置
 */

window.CONFIG = {
    // Google API Key (用于 3D Tiles 和 Places)
    GOOGLE_API_KEY: 'your-google-api-key-here',

    // 服务器配置，留空则使用 localhost
    SERVER_HOST: '',  // 例如: '192.168.1.100'
    REALTIME_PORT: 8080,  // Socket.IO 实时同步端口
    API_PORT: 8000,       // API 服务端口
};

// 生成完整 URL
(function() {
    const host = window.CONFIG.SERVER_HOST || 'localhost';
    window.CONFIG.REALTIME_SERVER = `http://${host}:${window.CONFIG.REALTIME_PORT}`;
    window.CONFIG.API_SERVER = `http://${host}:${window.CONFIG.API_PORT}`;
})();
