/**
 * photoEnhancer.js
 * 使用后端代理调用 Gemini API 将游戏截图转换为真实街景风格
 */

export class PhotoEnhancer {
    constructor(serverUrl = null) {
        // 服务器地址，null 则使用相对路径（同域部署）
        this.serverUrl = serverUrl || '';
        this.endpoint = `${this.serverUrl}/api/enhance`;
    }

    /**
     * 将 Blob 转换为 Base64
     */
    async blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * 增强照片 - 转换为真实街景风格
     * @param {Blob} imageBlob - 原始截图
     * @returns {Promise<Blob>} - 增强后的图片 Blob
     */
    async enhance(imageBlob) {
        console.log('[PhotoEnhancer] 开始增强处理...');

        const base64Image = await this.blobToBase64(imageBlob);

        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    image_base64: base64Image,
                    mime_type: imageBlob.type || 'image/png'
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
            }

            const data = await response.json();

            // 服务器返回 { image_base64, mime_type }
            const imageData = data.image_base64;
            const mimeType = data.mime_type || 'image/jpeg';

            // Base64 转 Blob
            const byteCharacters = atob(imageData);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const enhancedBlob = new Blob([byteArray], { type: mimeType });

            console.log(`[PhotoEnhancer] 增强完成: ${(enhancedBlob.size / 1024 / 1024).toFixed(2)}MB`);
            return enhancedBlob;

        } catch (error) {
            console.error('[PhotoEnhancer] 增强失败:', error);
            return null;
        }
    }

    /**
     * 后台增强并自动保存
     * @param {Blob} imageBlob - 原始截图
     * @param {string} originalFileName - 原始文件名
     */
    async enhanceAndSave(imageBlob, originalFileName) {
        const enhancedBlob = await this.enhance(imageBlob);

        if (enhancedBlob) {
            // 生成增强版文件名
            const enhancedFileName = originalFileName.replace('.png', '_AI.jpg');

            // 后台处理无法用 showSaveFilePicker（需要用户手势），直接自动下载
            const url = URL.createObjectURL(enhancedBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = enhancedFileName;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                URL.revokeObjectURL(url);
                document.body.removeChild(a);
            }, 1000);
            console.log(`[PhotoEnhancer] AI增强版已下载: ${enhancedFileName}`);
        }
    }
}
