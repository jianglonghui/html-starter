import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BaseScene } from './BaseScene.js';

/**
 * 跨海公路场景 - 平坦直道为主，两侧是大海
 */
export class SeaHighway extends BaseScene {
    constructor(world, scene, roadMat, wallMat) {
        super(world, scene, roadMat, wallMat);
        this.roadWidth = 16; // 稍宽一点的公路
        this.waterMeshes = []; // 水面网格
        this.createWater();
    }

    getName() {
        return '跨海公路';
    }

    createRoadTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        // 深色沥青路面
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, 128, 128);
        // 白色车道线
        ctx.fillStyle = '#fff';
        ctx.fillRect(60, 0, 8, 30);
        ctx.fillRect(60, 50, 8, 30);
        ctx.fillRect(60, 100, 8, 28);
        // 黄色边线
        ctx.fillStyle = '#ffcc00';
        ctx.fillRect(5, 0, 4, 128);
        ctx.fillRect(119, 0, 4, 128);
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    }

    createWater() {
        // 创建带细分的海面几何体，支持波浪动画
        const waterGeo = new THREE.PlaneGeometry(800, 800, 128, 128);

        // 湛蓝色海水材质
        const waterMat = new THREE.MeshPhongMaterial({
            color: 0x00cfff,
            specular: 0xaaeeff,
            shininess: 120,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide
        });

        // 左侧海面
        const waterLeft = new THREE.Mesh(waterGeo, waterMat);
        waterLeft.rotation.x = -Math.PI / 2;
        waterLeft.position.set(-420, -8, 0);
        this.scene.add(waterLeft);
        this.waterMeshes.push(waterLeft);

        // 右侧海面
        const waterRight = new THREE.Mesh(waterGeo.clone(), waterMat.clone());
        waterRight.rotation.x = -Math.PI / 2;
        waterRight.position.set(420, -8, 0);
        this.scene.add(waterRight);
        this.waterMeshes.push(waterRight);

        // 远处的海面（更大，不需要波浪细节）
        const farWaterGeo = new THREE.PlaneGeometry(3000, 3000);
        const farWaterMat = new THREE.MeshPhongMaterial({
            color: 0x00a0e0,
            transparent: true,
            opacity: 0.9
        });
        const farWater = new THREE.Mesh(farWaterGeo, farWaterMat);
        farWater.rotation.x = -Math.PI / 2;
        farWater.position.set(0, -9, 0);
        this.scene.add(farWater);
        this.waterMeshes.push(farWater);

        // 保存起始时间用于波浪动画
        this.waveTime = 0;
    }

    // 更新波浪动画
    updateWaves(deltaTime) {
        this.waveTime += deltaTime;

        // 只对前两个近处的海面做波浪
        for (let i = 0; i < 2 && i < this.waterMeshes.length; i++) {
            const water = this.waterMeshes[i];
            const positions = water.geometry.attributes.position;

            for (let j = 0; j < positions.count; j++) {
                const x = positions.getX(j);
                const y = positions.getY(j);

                // 多层波浪叠加
                const wave1 = Math.sin(x * 0.02 + this.waveTime * 2) * 0.5;
                const wave2 = Math.sin(y * 0.03 + this.waveTime * 1.5) * 0.3;
                const wave3 = Math.sin((x + y) * 0.01 + this.waveTime) * 0.8;

                positions.setZ(j, wave1 + wave2 + wave3);
            }

            positions.needsUpdate = true;
            water.geometry.computeVertexNormals();
        }
    }

    /**
     * 计算路径点 - 平缓的曲线，几乎没有坡度
     */
    calculateRoadPoint(z) {
        const i = Math.abs(z) / this.segLen;
        let x = 0, y = 0;

        if (i >= 3) {
            const t = i - 3;
            // 非常平缓的弯道
            x = Math.sin(t * 0.03) * 80 + Math.sin(t * 0.01) * 120;
            // 几乎没有坡度，只有轻微起伏
            y = Math.sin(t * 0.02) * 3;
        }

        return new THREE.Vector3(x, y, z);
    }

    generateNextSegment() {
        const i = this.segmentCounter;

        let x = 0, y = 0;
        if (i >= 3) {
            const t = i - 3;
            x = Math.sin(t * 0.03) * 80 + Math.sin(t * 0.01) * 120;
            y = Math.sin(t * 0.02) * 3;
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

            // 桥墩支撑（每隔一段）
            if (i % 8 === 0) {
                const pillarGeo = new THREE.BoxGeometry(2, 15, 3);
                const pillarMat = new THREE.MeshLambertMaterial({ color: 0x888888 });

                // 左侧桥墩
                const pillarLeft = new THREE.Mesh(pillarGeo, pillarMat);
                roadBody.pointToWorldFrame(new CANNON.Vec3(-this.roadWidth / 2 + 1, -7, 0), calcVec);
                pillarLeft.position.set(calcVec.x, calcVec.y, calcVec.z);
                this.scene.add(pillarLeft);
                segmentData.meshes.push(pillarLeft);

                // 右侧桥墩
                const pillarRight = new THREE.Mesh(pillarGeo, pillarMat);
                roadBody.pointToWorldFrame(new CANNON.Vec3(this.roadWidth / 2 - 1, -7, 0), calcVec);
                pillarRight.position.set(calcVec.x, calcVec.y, calcVec.z);
                this.scene.add(pillarRight);
                segmentData.meshes.push(pillarRight);
            }

            // 两侧护栏（银白色金属）
            const railMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.7, roughness: 0.3 });

            // 左侧护栏
            const railLeft = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 1.2, totalLen),
                railMat
            );
            roadBody.pointToWorldFrame(new CANNON.Vec3(-this.roadWidth / 2 + 0.3, 0.8, 0), calcVec);
            railLeft.position.set(calcVec.x, calcVec.y, calcVec.z);
            railLeft.quaternion.copy(roadBody.quaternion);
            this.scene.add(railLeft);
            segmentData.meshes.push(railLeft);

            // 右侧护栏
            const railRight = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 1.2, totalLen),
                railMat.clone()
            );
            roadBody.pointToWorldFrame(new CANNON.Vec3(this.roadWidth / 2 - 0.3, 0.8, 0), calcVec);
            railRight.position.set(calcVec.x, calcVec.y, calcVec.z);
            railRight.quaternion.copy(roadBody.quaternion);
            this.scene.add(railRight);
            segmentData.meshes.push(railRight);

            // 路灯（每隔几段）
            if (i % 5 === 0) {
                const lampPost = this.createLampPost();
                roadBody.pointToWorldFrame(new CANNON.Vec3(-this.roadWidth / 2 - 0.5, 0, 0), calcVec);
                lampPost.position.set(calcVec.x, calcVec.y, calcVec.z);
                this.scene.add(lampPost);
                segmentData.meshes.push(lampPost);
            }
        }

        // 更新水面位置跟随玩家
        this.waterMeshes.forEach(water => {
            water.position.z = z;
        });

        this.roadSegments.push(segmentData);
        this.cleanOldSegments();

        this.prevX = x;
        this.prevY = y;
        this.prevZ = z;
        this.segmentCounter++;
    }

    createLampPost() {
        const group = new THREE.Group();

        // 灯柱
        const pole = new THREE.Mesh(
            new THREE.CylinderGeometry(0.15, 0.2, 8, 8),
            new THREE.MeshLambertMaterial({ color: 0x444444 })
        );
        pole.position.y = 4;
        group.add(pole);

        // 灯头
        const lamp = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.3, 0.5),
            new THREE.MeshBasicMaterial({ color: 0xffffcc, emissive: 0xffffcc })
        );
        lamp.position.y = 8;
        group.add(lamp);

        return group;
    }

    dispose() {
        // 先调用父类清理路段
        super.dispose();

        // 清理水面
        if (this.waterMeshes) {
            this.waterMeshes.forEach(water => {
                this.scene.remove(water);
                if (water.geometry) water.geometry.dispose();
                if (water.material) water.material.dispose();
            });
            this.waterMeshes = [];
        }

        console.log('[SeaHighway] dispose 完成');
    }
}
