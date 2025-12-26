/**
 * photoEnhancer.js
 * 使用 Gemini API 将游戏截图转换为真实街景风格
 */

export class PhotoEnhancer {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.modelId = 'gemini-3-pro-image-preview';
        this.endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId}:generateContent`;
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
        if (!this.apiKey || this.apiKey === 'YOUR_GOOGLE_API_KEY_HERE') {
            console.warn('[PhotoEnhancer] API Key 未配置，跳过增强');
            return null;
        }

        console.log('[PhotoEnhancer] 开始增强处理...');

        const base64Image = await this.blobToBase64(imageBlob);

        const requestBody = {
            contents: [{
                role: "user",
                parts: [
                    {
                        inline_data: {
                            mime_type: "image/png",
                            data: base64Image
                        }
                    },
                    {
                        text: "Transform this 3D game screenshot into a photorealistic street photograph. Keep the same composition, perspective, and scene elements, but make it look like a real photo taken with a camera. Add realistic lighting, textures, weather effects, and natural imperfections. Output only the enhanced image."
                    }
                ]
            }],
            generationConfig: {
                responseModalities: ["IMAGE", "TEXT"]
            }
        };

        try {
            const response = await fetch(`${this.endpoint}?key=${this.apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
            }

            const data = await response.json();

            // 解析响应，提取图片
            const candidates = data.candidates;
            if (!candidates || candidates.length === 0) {
                throw new Error('API 未返回结果');
            }

            const parts = candidates[0].content?.parts;
            if (!parts) {
                throw new Error('响应格式异常');
            }

            // 查找图片数据（API 返回 camelCase: inlineData）
            for (const part of parts) {
                if (part.inlineData && part.inlineData.data) {
                    const imageData = part.inlineData.data;
                    const mimeType = part.inlineData.mimeType || 'image/png';

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
                }
            }

            throw new Error('响应中未找到图片数据');

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
