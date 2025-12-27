import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/**
 * 场景基类 - 定义场景生成的接口
 */
export class BaseScene {
    constructor(world, scene, roadMat, wallMat) {
        this.world = world;
        this.scene = scene;
        this.roadSegments = [];
        this.segmentCounter = 0;
        this.prevX = 0;
        this.prevY = 0;
        this.prevZ = 0;
        this.segLen = 15;
        this.roadWidth = 14;

        // 物理材质（从主程序传入，确保ContactMaterial生效）
        this.roadMat = roadMat;
        this.wallMat = wallMat;

        // 路面纹理
        this.roadTex = this.createRoadTexture();
    }

    createRoadTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#666';
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = '#fff';
        ctx.fillRect(60, 0, 8, 40);
        ctx.fillRect(60, 64, 8, 40);
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    }

    /**
     * 计算路径点 - 子类必须实现
     * @param {number} z - Z坐标
     * @returns {THREE.Vector3} 路径点位置
     */
    calculateRoadPoint(z) {
        throw new Error('子类必须实现 calculateRoadPoint');
    }

    /**
     * 生成下一段路 - 子类必须实现
     */
    generateNextSegment() {
        throw new Error('子类必须实现 generateNextSegment');
    }

    /**
     * 清理旧路段
     */
    cleanOldSegments(keepCount = 80) {
        if (this.roadSegments.length > keepCount) {
            const oldSeg = this.roadSegments.shift();
            oldSeg.bodies.forEach(b => this.world.removeBody(b));
            oldSeg.meshes.forEach(m => {
                this.scene.remove(m);
                if (m.geometry) m.geometry.dispose();
                if (m.material) {
                    if (Array.isArray(m.material)) {
                        m.material.forEach(mat => mat.dispose());
                    } else {
                        m.material.dispose();
                    }
                }
            });
        }
    }

    /**
     * 获取场景名称
     */
    getName() {
        return 'BaseScene';
    }

    /**
     * 完全销毁场景 - 清理所有路段和资源
     */
    dispose() {
        console.log(`[${this.getName()}] dispose: 清理 ${this.roadSegments.length} 个路段`);

        // 清理所有路段
        for (const seg of this.roadSegments) {
            // 移除物理体
            if (seg.bodies) {
                seg.bodies.forEach(b => {
                    if (this.world.bodies.includes(b)) {
                        this.world.removeBody(b);
                    }
                });
            }
            // 移除 mesh 并释放资源
            if (seg.meshes) {
                seg.meshes.forEach(m => {
                    this.scene.remove(m);
                    if (m.geometry) m.geometry.dispose();
                    if (m.material) {
                        if (Array.isArray(m.material)) {
                            m.material.forEach(mat => mat.dispose());
                        } else {
                            m.material.dispose();
                        }
                    }
                });
            }
        }
        this.roadSegments = [];

        // 清理路面纹理
        if (this.roadTex) {
            this.roadTex.dispose();
            this.roadTex = null;
        }
    }
}
