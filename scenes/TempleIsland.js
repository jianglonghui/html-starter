import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BaseScene } from './BaseScene.js';
import { OBJLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/OBJLoader.js';

/**
 * 神庙海岛场景 - 穿越群岛的海上公路
 */
export class TempleIsland extends BaseScene {
    constructor(world, scene, roadMat, wallMat) {
        super(world, scene, roadMat, wallMat);
        this.roadWidth = 14;
        this.waterMeshes = [];
        this.islands = []; // 岛屿列表
        this.templeLoaded = false;

        this.createWater();
        this.loadTemple();
    }

    getName() {
        return '神庙海岛';
    }

    createRoadTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        // 石板路面
        ctx.fillStyle = '#8B7355';
        ctx.fillRect(0, 0, 128, 128);
        // 石板纹理
        ctx.strokeStyle = '#6B5344';
        ctx.lineWidth = 2;
        for (let i = 0; i < 128; i += 24) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(128, i);
            ctx.stroke();
        }
        for (let i = 0; i < 128; i += 32) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, 128);
            ctx.stroke();
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    }

    createWater() {
        // 湛蓝大海
        const waterGeo = new THREE.PlaneGeometry(2000, 2000, 64, 64);
        const waterMat = new THREE.MeshPhongMaterial({
            color: 0x00cfff,
            specular: 0xaaeeff,
            shininess: 100,
            transparent: true,
            opacity: 0.85
        });
        const water = new THREE.Mesh(waterGeo, waterMat);
        water.rotation.x = -Math.PI / 2;
        water.position.y = -5;
        this.scene.add(water);
        this.waterMeshes.push(water);

        this.waveTime = 0;
    }

    loadTemple() {
        const loader = new OBJLoader();
        const textureLoader = new THREE.TextureLoader();

        const diffuseMap = textureLoader.load('./island_temple/texture_diffuse.png');
        const normalMap = textureLoader.load('./island_temple/texture_normal.png');

        loader.load('./island_temple/base.obj', (obj) => {
            obj.traverse((child) => {
                if (child.isMesh) {
                    child.material = new THREE.MeshStandardMaterial({
                        map: diffuseMap,
                        normalMap: normalMap,
                        roughness: 0.7,
                        metalness: 0.1
                    });
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
            obj.scale.set(8, 8, 8);
            this.templeModel = obj;
            this.templeLoaded = true;
        });
    }

    createIsland(x, z, size) {
        const group = new THREE.Group();

        // 岛屿地面
        const islandGeo = new THREE.CylinderGeometry(size, size + 5, 6, 16);
        const islandMat = new THREE.MeshLambertMaterial({ color: 0x4a7c23 });
        const island = new THREE.Mesh(islandGeo, islandMat);
        island.position.y = -3;
        group.add(island);

        // 沙滩
        const beachGeo = new THREE.CylinderGeometry(size + 5, size + 8, 2, 16);
        const beachMat = new THREE.MeshLambertMaterial({ color: 0xc2b280 });
        const beach = new THREE.Mesh(beachGeo, beachMat);
        beach.position.y = -5;
        group.add(beach);

        // 添加棕榈树
        const treeCount = Math.floor(size / 10);
        for (let i = 0; i < treeCount; i++) {
            const angle = (i / treeCount) * Math.PI * 2 + Math.random() * 0.5;
            const r = size * 0.6 + Math.random() * size * 0.3;
            const tree = this.createPalmTree();
            tree.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
            group.add(tree);
        }

        group.position.set(x, 0, z);
        this.scene.add(group);
        this.islands.push(group);

        return group;
    }

    createPalmTree() {
        const group = new THREE.Group();

        const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, 6, 6);
        const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 3;
        group.add(trunk);

        const leafMat = new THREE.MeshLambertMaterial({ color: 0x228B22, side: THREE.DoubleSide });
        for (let i = 0; i < 6; i++) {
            const leafGeo = new THREE.ConeGeometry(0.8, 4, 4);
            const leaf = new THREE.Mesh(leafGeo, leafMat);
            leaf.position.y = 6;
            leaf.rotation.z = 0.8;
            leaf.rotation.y = (i / 6) * Math.PI * 2;
            group.add(leaf);
        }

        return group;
    }

    updateWaves(deltaTime) {
        this.waveTime += deltaTime;

        if (this.waterMeshes.length > 0) {
            const water = this.waterMeshes[0];
            const positions = water.geometry.attributes.position;

            for (let i = 0; i < positions.count; i++) {
                const x = positions.getX(i);
                const y = positions.getY(i);
                const wave = Math.sin(x * 0.015 + this.waveTime * 1.5) * 0.8 +
                            Math.sin(y * 0.02 + this.waveTime) * 0.5;
                positions.setZ(i, wave);
            }
            positions.needsUpdate = true;
            water.geometry.computeVertexNormals();
        }

        // 更新海面位置跟随
        if (this.waterMeshes[0]) {
            this.waterMeshes[0].position.z = this.prevZ;
        }
    }

    /**
     * 计算路径点 - 弯曲的海上公路
     */
    calculateRoadPoint(z) {
        const i = Math.abs(z) / this.segLen;
        let x = 0, y = 0;

        if (i >= 3) {
            const t = i - 3;
            // 缓和的S弯
            x = Math.sin(t * 0.04) * 60 + Math.sin(t * 0.02) * 30;
            // 轻微起伏
            y = Math.sin(t * 0.03) * 2;
        }

        return new THREE.Vector3(x, y, z);
    }

    generateNextSegment() {
        const i = this.segmentCounter;

        let x = 0, y = 0;
        if (i >= 3) {
            const t = i - 3;
            x = Math.sin(t * 0.04) * 60 + Math.sin(t * 0.02) * 30;
            y = Math.sin(t * 0.03) * 2;
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
                new THREE.BoxGeometry(this.roadWidth, 0.4, totalLen + 1),
                new THREE.MeshLambertMaterial({ map: this.roadTex })
            );
            roadBody.pointToWorldFrame(new CANNON.Vec3(0, 1, 0), calcVec);
            roadMesh.position.set(calcVec.x, calcVec.y, calcVec.z);
            roadMesh.quaternion.copy(roadBody.quaternion);
            roadMesh.receiveShadow = true;
            this.scene.add(roadMesh);
            segmentData.meshes.push(roadMesh);

            // 桥墩
            if (i % 6 === 0) {
                const pillarGeo = new THREE.BoxGeometry(1.5, 8, 1.5);
                const pillarMat = new THREE.MeshLambertMaterial({ color: 0x888888 });

                const pillarL = new THREE.Mesh(pillarGeo, pillarMat);
                roadBody.pointToWorldFrame(new CANNON.Vec3(-this.roadWidth / 2 + 1, -4, 0), calcVec);
                pillarL.position.set(calcVec.x, calcVec.y, calcVec.z);
                this.scene.add(pillarL);
                segmentData.meshes.push(pillarL);

                const pillarR = new THREE.Mesh(pillarGeo, pillarMat);
                roadBody.pointToWorldFrame(new CANNON.Vec3(this.roadWidth / 2 - 1, -4, 0), calcVec);
                pillarR.position.set(calcVec.x, calcVec.y, calcVec.z);
                this.scene.add(pillarR);
                segmentData.meshes.push(pillarR);
            }

            // 石柱护栏
            const railMat = new THREE.MeshStandardMaterial({ color: 0xccccaa, roughness: 0.8 });
            const railL = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 1, totalLen),
                railMat
            );
            roadBody.pointToWorldFrame(new CANNON.Vec3(-this.roadWidth / 2 + 0.3, 0.7, 0), calcVec);
            railL.position.set(calcVec.x, calcVec.y, calcVec.z);
            railL.quaternion.copy(roadBody.quaternion);
            this.scene.add(railL);
            segmentData.meshes.push(railL);

            const railR = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 1, totalLen),
                railMat.clone()
            );
            roadBody.pointToWorldFrame(new CANNON.Vec3(this.roadWidth / 2 - 0.3, 0.7, 0), calcVec);
            railR.position.set(calcVec.x, calcVec.y, calcVec.z);
            railR.quaternion.copy(roadBody.quaternion);
            this.scene.add(railR);
            segmentData.meshes.push(railR);

            // 每隔一段距离生成岛屿和神庙
            if (i % 25 === 0 && i > 10) {
                // 随机在路边生成岛屿
                const side = Math.random() > 0.5 ? 1 : -1;
                const islandX = x + side * (40 + Math.random() * 30);
                const islandSize = 20 + Math.random() * 15;
                const island = this.createIsland(islandX, z, islandSize);

                // 有概率放置神庙
                if (this.templeLoaded && Math.random() > 0.5) {
                    const temple = this.templeModel.clone();
                    temple.position.set(islandX, 0, z);
                    temple.rotation.y = Math.random() * Math.PI * 2;
                    this.scene.add(temple);
                    segmentData.meshes.push(temple);
                }
            }
        }

        this.roadSegments.push(segmentData);
        this.cleanOldSegments();

        this.prevX = x;
        this.prevY = y;
        this.prevZ = z;
        this.segmentCounter++;
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

        console.log('[TempleIsland] dispose 完成');
    }
}
