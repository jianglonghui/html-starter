import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BaseScene } from './BaseScene.js';

/**
 * 沙漠魔鬼城场景 - 雅丹地貌中的荒漠公路
 */
export class DesertYardang extends BaseScene {
    constructor(world, scene, roadMat, wallMat) {
        super(world, scene, roadMat, wallMat);
        this.roadWidth = 10; // 荒漠公路较窄
        this.yardangs = []; // 雅丹土丘列表

        // 颜色方案
        this.yardangColors = [
            0xc9a86c, // 土黄
            0xb8956a, // 橙褐
            0xa89070, // 灰黄
            0xd4a55a, // 沙金
            0x9c8060  // 深褐
        ];

        this.createDesertGround();
        this.createSky();
        this.setupFog();
    }

    getName() {
        return '沙漠魔鬼城';
    }

    createRoadTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // 深灰柏油路面
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(0, 0, 128, 128);

        // 路面纹理（细微颗粒感）
        ctx.fillStyle = '#444';
        for (let i = 0; i < 100; i++) {
            const x = Math.random() * 128;
            const y = Math.random() * 128;
            ctx.fillRect(x, y, 2, 2);
        }

        // 中线（虚线）
        ctx.fillStyle = '#ffcc00';
        ctx.fillRect(62, 0, 4, 30);
        ctx.fillRect(62, 50, 4, 30);
        ctx.fillRect(62, 100, 4, 28);

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    }

    createDesertGround() {
        // 沙漠地面
        const groundGeo = new THREE.PlaneGeometry(2000, 2000, 32, 32);

        // 给地面添加一些起伏
        const positions = groundGeo.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i);
            const z = Math.sin(x * 0.01) * 0.5 + Math.cos(y * 0.01) * 0.5;
            positions.setZ(i, z);
        }
        groundGeo.computeVertexNormals();

        // 沙漠材质
        const groundMat = new THREE.MeshLambertMaterial({
            color: 0xd4b896,
            side: THREE.DoubleSide
        });

        this.ground = new THREE.Mesh(groundGeo, groundMat);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.y = -0.5;
        this.ground.receiveShadow = true;
        this.scene.add(this.ground);
    }

    createSky() {
        // 黄昏天空 - 渐变色
        const skyGeo = new THREE.SphereGeometry(800, 32, 32);

        // 创建渐变纹理
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');

        const gradient = ctx.createLinearGradient(0, 0, 0, 256);
        gradient.addColorStop(0, '#1a1a2e');    // 深蓝（天顶）
        gradient.addColorStop(0.3, '#4a3f55');  // 紫灰
        gradient.addColorStop(0.5, '#c67b4e');  // 橙红
        gradient.addColorStop(0.7, '#e8a857');  // 金黄
        gradient.addColorStop(1, '#d4b896');    // 沙黄（地平线）

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 256);

        const skyTex = new THREE.CanvasTexture(canvas);
        const skyMat = new THREE.MeshBasicMaterial({
            map: skyTex,
            side: THREE.BackSide
        });

        const sky = new THREE.Mesh(skyGeo, skyMat);
        this.scene.add(sky);

        // 调整光照为暖色
        const sunLight = this.scene.getObjectByProperty('type', 'DirectionalLight');
        if (sunLight) {
            sunLight.color.setHex(0xffaa55);
            sunLight.intensity = 1.2;
            sunLight.position.set(100, 30, -50);
        }

        // 调整环境光
        const ambientLight = this.scene.getObjectByProperty('type', 'AmbientLight');
        if (ambientLight) {
            ambientLight.color.setHex(0xffddaa);
            ambientLight.intensity = 0.5;
        }
    }

    setupFog() {
        // 沙尘雾气效果
        this.scene.fog = new THREE.Fog(0xd4b090, 50, 400);
    }

    /**
     * 创建连绵山丘群（雅丹地貌）
     */
    createHillRange(x, z) {
        const group = new THREE.Group();

        // 山脊长度和宽度
        const length = 40 + Math.random() * 30; // 沿Z方向
        const width = 25 + Math.random() * 20;  // 沿X方向
        const baseHeight = 15 + Math.random() * 15;

        // 随机选择基础颜色
        const baseColor = this.yardangColors[Math.floor(Math.random() * this.yardangColors.length)];

        // 创建主山体 - 使用变形的平面几何体
        const segX = 12;
        const segZ = 16;
        const hillGeo = new THREE.PlaneGeometry(width, length, segX, segZ);

        // 变形顶点创建山丘起伏
        const positions = hillGeo.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            const px = positions.getX(i);
            const py = positions.getY(i);

            // 计算到边缘的距离（用于让边缘降低）
            const edgeFactorX = 1 - Math.pow(Math.abs(px) / (width / 2), 2);
            const edgeFactorZ = 1 - Math.pow(Math.abs(py) / (length / 2), 1.5);
            const edgeFactor = Math.max(0, edgeFactorX * edgeFactorZ);

            // 主山脊高度
            const ridgeHeight = baseHeight * edgeFactor;

            // 添加多个山峰
            const peak1 = Math.exp(-Math.pow(px + 3, 2) / 30 - Math.pow(py + 5, 2) / 80) * 12;
            const peak2 = Math.exp(-Math.pow(px - 4, 2) / 40 - Math.pow(py - 8, 2) / 60) * 10;
            const peak3 = Math.exp(-Math.pow(px, 2) / 50 - Math.pow(py, 2) / 100) * 8;

            // 添加噪声让表面更不规则
            const noise = (Math.random() - 0.5) * 3;

            // 层状效果（雅丹特征）
            const layerNoise = Math.sin(ridgeHeight * 0.5) * 0.8;

            const height = ridgeHeight + peak1 + peak2 + peak3 + noise + layerNoise;
            positions.setZ(i, Math.max(0, height));
        }
        hillGeo.computeVertexNormals();

        // 创建材质
        const hillMat = new THREE.MeshLambertMaterial({
            color: baseColor,
            side: THREE.DoubleSide,
            flatShading: true
        });

        const hill = new THREE.Mesh(hillGeo, hillMat);
        hill.rotation.x = -Math.PI / 2;
        hill.castShadow = true;
        hill.receiveShadow = true;
        group.add(hill);

        // 添加一些独立的台地/山丘点缀（扁平顶或尖顶随机）
        const peakCount = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < peakCount; i++) {
            const peakHeight = 8 + Math.random() * 15;
            const peakRadiusBottom = 4 + Math.random() * 6;
            const isFlat = Math.random() > 0.3; // 70%是扁平顶
            const peakRadiusTop = isFlat ? peakRadiusBottom * (0.5 + Math.random() * 0.4) : peakRadiusBottom * 0.1;
            const segments = 5 + Math.floor(Math.random() * 4);

            const peakGeo = new THREE.CylinderGeometry(peakRadiusTop, peakRadiusBottom, peakHeight, segments);

            // 变形让山丘不规则
            const peakPos = peakGeo.attributes.position;
            for (let j = 0; j < peakPos.count; j++) {
                const vx = peakPos.getX(j);
                const vy = peakPos.getY(j);
                const vz = peakPos.getZ(j);
                // 水平方向随机偏移
                peakPos.setX(j, vx + (Math.random() - 0.5) * 2);
                peakPos.setZ(j, vz + (Math.random() - 0.5) * 2);
            }
            peakGeo.computeVertexNormals();

            const peakColor = this.yardangColors[Math.floor(Math.random() * this.yardangColors.length)];
            const peakMat = new THREE.MeshLambertMaterial({
                color: peakColor,
                flatShading: true
            });
            const peak = new THREE.Mesh(peakGeo, peakMat);

            // 放置在山体上
            const offsetX = (Math.random() - 0.5) * width * 0.6;
            const offsetZ = (Math.random() - 0.5) * length * 0.6;
            peak.position.set(offsetX, peakHeight / 2 + 5, offsetZ);
            peak.castShadow = true;
            group.add(peak);
        }

        // 定位山丘群
        group.position.set(x, 0, z);

        // 轻微随机旋转
        group.rotation.y = (Math.random() - 0.5) * 0.3;

        this.scene.add(group);
        this.yardangs.push(group);

        return group;
    }

    /**
     * 创建小石块/碎石
     */
    createRocks(x, z, count = 5) {
        for (let i = 0; i < count; i++) {
            const rockGeo = new THREE.DodecahedronGeometry(0.3 + Math.random() * 0.5, 0);
            const rockMat = new THREE.MeshLambertMaterial({
                color: this.yardangColors[Math.floor(Math.random() * this.yardangColors.length)]
            });
            const rock = new THREE.Mesh(rockGeo, rockMat);
            rock.position.set(
                x + (Math.random() - 0.5) * 10,
                0.2,
                z + (Math.random() - 0.5) * 10
            );
            rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            rock.castShadow = true;
            this.scene.add(rock);
        }
    }

    /**
     * 计算路径点 - 蜿蜒的沙漠公路
     */
    calculateRoadPoint(z) {
        const i = Math.abs(z) / this.segLen;
        let x = 0, y = 0;

        if (i >= 3) {
            const t = i - 3;
            // 更蜿蜒的曲线，多重正弦叠加
            x = Math.sin(t * 0.05) * 50 + Math.sin(t * 0.02) * 35 + Math.sin(t * 0.08) * 15;
            // 轻微起伏
            y = Math.sin(t * 0.015) * 1.5;
        }

        return new THREE.Vector3(x, y, z);
    }

    generateNextSegment() {
        const i = this.segmentCounter;

        let x = 0, y = 0;
        if (i >= 3) {
            const t = i - 3;
            x = Math.sin(t * 0.05) * 50 + Math.sin(t * 0.02) * 35 + Math.sin(t * 0.08) * 15;
            y = Math.sin(t * 0.015) * 1.5;
        }
        const z = -i * this.segLen;

        const segmentData = { bodies: [], meshes: [] };

        if (i > 0) {
            const dx = x - this.prevX;
            const dy = y - this.prevY;
            const dz = z - this.prevZ;
            const horizontalLen = Math.sqrt(dx * dx + dz * dz);
            const totalLen = Math.sqrt(dx * dx + dy * dy + dz * dz);

            const yaw = Math.atan2(dx, dz);
            const pitch = -Math.atan2(dy, horizontalLen);

            const calcVec = new CANNON.Vec3();

            // 物理路面
            const roadBody = new CANNON.Body({ mass: 0, material: this.roadMat });
            roadBody.addShape(new CANNON.Box(new CANNON.Vec3(this.roadWidth / 2, 1, totalLen / 2 + 0.5)));
            roadBody.position.set((x + this.prevX) / 2, (y + this.prevY) / 2 - 1, (z + this.prevZ) / 2);

            const qYaw = new CANNON.Quaternion();
            qYaw.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw);
            const qPitch = new CANNON.Quaternion();
            qPitch.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), pitch);
            roadBody.quaternion = qYaw.mult(qPitch);

            this.world.addBody(roadBody);
            segmentData.bodies.push(roadBody);

            // 视觉路面
            const roadMesh = new THREE.Mesh(
                new THREE.BoxGeometry(this.roadWidth, 0.3, totalLen + 1),
                new THREE.MeshLambertMaterial({ map: this.roadTex })
            );
            roadBody.pointToWorldFrame(new CANNON.Vec3(0, 1, 0), calcVec);
            roadMesh.position.set(calcVec.x, calcVec.y, calcVec.z);
            roadMesh.quaternion.copy(roadBody.quaternion);
            roadMesh.receiveShadow = true;
            this.scene.add(roadMesh);
            segmentData.meshes.push(roadMesh);

            // 路肩（沙土色）
            const shoulderMat = new THREE.MeshLambertMaterial({ color: 0xc9a86c });
            const shoulderL = new THREE.Mesh(
                new THREE.BoxGeometry(2, 0.2, totalLen + 1),
                shoulderMat
            );
            roadBody.pointToWorldFrame(new CANNON.Vec3(-this.roadWidth / 2 - 1, 0.9, 0), calcVec);
            shoulderL.position.set(calcVec.x, calcVec.y, calcVec.z);
            shoulderL.quaternion.copy(roadBody.quaternion);
            this.scene.add(shoulderL);
            segmentData.meshes.push(shoulderL);

            const shoulderR = new THREE.Mesh(
                new THREE.BoxGeometry(2, 0.2, totalLen + 1),
                shoulderMat.clone()
            );
            roadBody.pointToWorldFrame(new CANNON.Vec3(this.roadWidth / 2 + 1, 0.9, 0), calcVec);
            shoulderR.position.set(calcVec.x, calcVec.y, calcVec.z);
            shoulderR.quaternion.copy(roadBody.quaternion);
            this.scene.add(shoulderR);
            segmentData.meshes.push(shoulderR);

            // 路边碎石（稀疏）
            if (i % 5 === 0) {
                this.createRocks(x - 8 - Math.random() * 10, z);
                this.createRocks(x + 8 + Math.random() * 10, z);
            }

            // 山丘（随机分布，有近有远）
            if (i % 3 === 0) {
                // 随机决定哪一侧有山丘
                const side = Math.random() > 0.5 ? 1 : -1;
                // 距离有近有远 (25-80米)
                const distance = 25 + Math.random() * 55;
                this.createHillRange(x + side * distance, z);

                // 50%概率另一侧也有（距离可能不同）
                if (Math.random() > 0.5) {
                    const distance2 = 30 + Math.random() * 60;
                    this.createHillRange(x - side * distance2, z);
                }
            }

            // 里程碑（每100米）
            if (i % 7 === 0 && i > 5) {
                const milestoneGeo = new THREE.BoxGeometry(0.3, 1, 0.15);
                const milestoneMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
                const milestone = new THREE.Mesh(milestoneGeo, milestoneMat);
                roadBody.pointToWorldFrame(new CANNON.Vec3(this.roadWidth / 2 + 0.5, 0.5, 0), calcVec);
                milestone.position.set(calcVec.x, calcVec.y + 0.5, calcVec.z);
                this.scene.add(milestone);
                segmentData.meshes.push(milestone);
            }
        }

        this.roadSegments.push(segmentData);
        this.cleanOldSegments();

        // 清理远处的雅丹土丘
        this.cleanOldYardangs();

        this.prevX = x;
        this.prevY = y;
        this.prevZ = z;
        this.segmentCounter++;

        // 更新地面位置跟随
        if (this.ground) {
            this.ground.position.z = this.prevZ;
        }
    }

    cleanOldYardangs() {
        // 清理太远的土丘
        const keepZ = this.prevZ + 200;
        for (let i = this.yardangs.length - 1; i >= 0; i--) {
            if (this.yardangs[i].position.z > keepZ) {
                this.yardangs[i].traverse(child => {
                    if (child.isMesh) {
                        if (child.geometry) child.geometry.dispose();
                        if (child.material) child.material.dispose();
                    }
                });
                this.scene.remove(this.yardangs[i]);
                this.yardangs.splice(i, 1);
            }
        }
    }

    /**
     * 清理场景资源
     */
    dispose() {
        // 清理地面
        if (this.ground) {
            this.scene.remove(this.ground);
            this.ground.geometry.dispose();
            this.ground.material.dispose();
        }

        // 清理所有山丘
        this.yardangs.forEach(y => {
            y.traverse(child => {
                if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) child.material.dispose();
                }
            });
            this.scene.remove(y);
        });
        this.yardangs = [];

        // 清理雾气
        this.scene.fog = null;

        // 清理天空（查找并移除）
        const toRemove = [];
        this.scene.traverse(child => {
            if (child.isMesh && child.geometry?.type === 'SphereGeometry' && child.geometry?.parameters?.radius > 500) {
                toRemove.push(child);
            }
        });
        toRemove.forEach(obj => {
            this.scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (obj.material.map) obj.material.map.dispose();
                obj.material.dispose();
            }
        });
    }
}
