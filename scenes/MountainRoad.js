import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BaseScene } from './BaseScene.js';

/**
 * 盘山公路场景 - S弯 + 上下坡
 */
export class MountainRoad extends BaseScene {
    constructor(world, scene, roadMat, wallMat) {
        super(world, scene, roadMat, wallMat);
    }

    getName() {
        return '盘山公路';
    }

    /**
     * 计算路径点
     */
    calculateRoadPoint(z) {
        const i = Math.abs(z) / this.segLen;
        let x = 0, y = 0;
        if (i >= 5) {
            const t = i - 5;
            // S弯组合
            x = Math.sin(t * 0.2) * 35 + Math.sin(t * 0.05) * 60;
            // 坡度起伏
            y = Math.sin(t * 0.08) * 25;
        }
        return new THREE.Vector3(x, y, z);
    }

    /**
     * 生成下一段路
     */
    generateNextSegment() {
        const i = this.segmentCounter;

        // 路径算法
        let x = 0, y = 0;
        if (i >= 5) {
            const t = i - 5;
            x = Math.sin(t * 0.2) * 35 + Math.sin(t * 0.05) * 60;
            y = Math.sin(t * 0.08) * 25;
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
                new THREE.BoxGeometry(this.roadWidth, 0.2, totalLen + 1),
                new THREE.MeshLambertMaterial({ map: this.roadTex })
            );
            roadBody.pointToWorldFrame(new CANNON.Vec3(0, 1, 0), calcVec);
            roadMesh.position.set(calcVec.x, calcVec.y, calcVec.z);
            roadMesh.quaternion.copy(roadBody.quaternion);
            roadMesh.receiveShadow = true;
            this.scene.add(roadMesh);
            segmentData.meshes.push(roadMesh);

            // 左侧山壁
            const wallBody = new CANNON.Body({ mass: 0, material: this.wallMat });
            wallBody.addShape(new CANNON.Box(new CANNON.Vec3(1, 8, totalLen / 2)));
            roadBody.pointToWorldFrame(new CANNON.Vec3(-this.roadWidth / 2 - 1, 5, 0), wallBody.position);
            wallBody.quaternion.copy(roadBody.quaternion);
            this.world.addBody(wallBody);
            segmentData.bodies.push(wallBody);

            const wallMesh = new THREE.Mesh(
                new THREE.BoxGeometry(2, 16, totalLen + 2),
                new THREE.MeshLambertMaterial({ color: 0x4d3c2e })
            );
            wallMesh.position.copy(wallBody.position);
            wallMesh.quaternion.copy(wallBody.quaternion);
            this.scene.add(wallMesh);
            segmentData.meshes.push(wallMesh);

            // 右侧护栏
            const rail = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 1, totalLen),
                new THREE.MeshStandardMaterial({ color: 0xeeeeee })
            );
            roadBody.pointToWorldFrame(new CANNON.Vec3(this.roadWidth / 2 - 0.5, 0.6, 0), calcVec);
            rail.position.set(calcVec.x, calcVec.y, calcVec.z);
            rail.quaternion.copy(roadBody.quaternion);
            this.scene.add(rail);
            segmentData.meshes.push(rail);

            // 随机乱石
            if (Math.random() > 0.8) {
                const rock = new THREE.Mesh(
                    new THREE.DodecahedronGeometry(1 + Math.random() * 2, 0),
                    new THREE.MeshLambertMaterial({ color: 0x777777 })
                );
                roadBody.pointToWorldFrame(new CANNON.Vec3(-this.roadWidth / 2 - 3, 1, (Math.random() - 0.5) * 10), calcVec);
                rock.position.set(calcVec.x, calcVec.y, calcVec.z);
                rock.rotation.set(Math.random(), Math.random(), Math.random());
                this.scene.add(rock);
                segmentData.meshes.push(rock);
            }
        }

        this.roadSegments.push(segmentData);
        this.cleanOldSegments();

        this.prevX = x;
        this.prevY = y;
        this.prevZ = z;
        this.segmentCounter++;
    }
}
