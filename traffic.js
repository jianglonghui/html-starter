import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/**
 * 生成香港车牌号码
 * 格式: 2个英文字母 + 1-4位数字 (如 AB 1234)
 */
function generateHKPlateNumber() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // 排除 I 和 O 避免混淆
    const letter1 = letters[Math.floor(Math.random() * letters.length)];
    const letter2 = letters[Math.floor(Math.random() * letters.length)];
    const numDigits = 1 + Math.floor(Math.random() * 4); // 1-4位数字
    let number = '';
    for (let i = 0; i < numDigits; i++) {
        number += Math.floor(Math.random() * 10);
    }
    return `${letter1}${letter2} ${number}`;
}

/**
 * 创建车牌纹理
 * @param {string} plateNumber - 车牌号码
 * @param {boolean} isFront - 是否为前车牌 (白底黑字)，否则为后车牌 (黄底黑字)
 */
function createPlateTexture(plateNumber, isFront) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');

    // 背景色: 前牌白底，后牌黄底
    ctx.fillStyle = isFront ? '#ffffff' : '#ffcc00';
    ctx.fillRect(0, 0, 128, 48);

    // 边框
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, 124, 44);

    // 车牌文字
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(plateNumber, 64, 26);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

/**
 * 道路坐标核心算法 - 使用全局场景的计算函数
 */
export function calculateRoadPoint(z) {
    if (window.calculateRoadPoint && window.calculateRoadPoint !== calculateRoadPoint) {
        return window.calculateRoadPoint(z);
    }
    // 后备：简单直线
    return new THREE.Vector3(0, 0, z);
}

export class NPCVehicle {
    constructor(startZ, laneOffset, world, scene, dna = null) {
        this.world = world;
        this.scene = scene;
        this.laneOffset = laneOffset;

        // 优先使用：传入的dna > 训练得到的最佳参数 > 默认值
        const defaultDNA = {
            lookAheadDist: 18,
            steerGain: 0.6,
            engineForce: 3000
        };
        this.dna = dna || window.bestTrainedDNA || defaultDNA;

        // 使用基因中的参数
        this.lookAheadDist = this.dna.lookAheadDist;
        this.steerGain = this.dna.steerGain;
        this.engineForce = this.dna.engineForce;

        // 期望时速波动 (12m/s ~ 22m/s)
        this.targetSpeed = 12 + Math.random() * 10;

        // 稳定期计数器（等待物理稳定后再启动驾驶）
        // 训练模式下drive()每帧调用4次，所以需要更大的值
        this.spawnTicks = 0;
        this.stabilizationPeriod = 120; // 普通模式4秒，训练模式1秒

        // --- 1. 物理底盘（与主驾车一致）---
        const chassisShape = new CANNON.Box(new CANNON.Vec3(1, 0.2, 2.2));
        this.chassisBody = new CANNON.Body({ mass: 1500 });
        this.chassisBody.addShape(chassisShape);
        this.chassisBody.angularDamping = 0.5;

        const data = calculateRoadPoint(startZ);
        const prevData = calculateRoadPoint(startZ + 5); // 后方5米
        const nextData = calculateRoadPoint(startZ - 5); // 前方5米

        // 初始化位置与旋转 (贴近路面生成)
        this.chassisBody.position.set(data.x + laneOffset, data.y + 0.6, startZ);

        // 计算车头朝向 (yaw)
        
        const dx = nextData.x - data.x;
        const dz = nextData.z - data.z;
        const yaw = Math.atan2(dx, dz) + Math.PI;

        // 计算坡度 (pitch) - 用前后10米范围计算更准确
        const dy = nextData.y - prevData.y;
        const horizontalDist = Math.sqrt(
            Math.pow(nextData.x - prevData.x, 2) +
            Math.pow(nextData.z - prevData.z, 2)
        );
        const pitch = -Math.atan2(dy, horizontalDist);

        const qYaw = new CANNON.Quaternion();
        qYaw.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yaw);
        const qPitch = new CANNON.Quaternion();
        qPitch.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), pitch);
        this.chassisBody.quaternion = qYaw.mult(qPitch);

        // 从训练数据随机获取初始速度
        let initialSpeed = 8 + Math.random() * 6; // 默认 8-14 m/s
        const samples = window.humanDrivingSamples;
        if (samples && samples.length > 0) {
            const randomSample = samples[Math.floor(Math.random() * samples.length)];
            initialSpeed = Math.max(5, randomSample.speed); // 至少5m/s
        }

        // 计算车头朝向的速度向量
        const forward = new CANNON.Vec3(0, 0, -1); // 本地前方
        this.chassisBody.quaternion.vmult(forward, forward); // 转到世界坐标
        this.chassisBody.velocity.set(
            forward.x * initialSpeed,
            0,
            forward.z * initialSpeed
        );
        this.chassisBody.angularVelocity.set(0, 0, 0);

        this.world.addBody(this.chassisBody);

        // --- 2. RaycastVehicle 物理悬挂 ---
        this.vehicle = new CANNON.RaycastVehicle({
            chassisBody: this.chassisBody,
            indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2,
        });

        // 悬挂参数（与主驾车一致）
        const wheelOptions = {
            radius: 0.45,
            directionLocal: new CANNON.Vec3(0, -1, 0),
            suspensionStiffness: 40,
            suspensionRestLength: 0.4,
            frictionSlip: 2.5,
            dampingRelaxation: 2.3,
            dampingCompression: 4.4,
            maxSuspensionForce: 100000,
            rollInfluence: 0.1,
            axleLocal: new CANNON.Vec3(1, 0, 0),
            chassisConnectionPointLocal: new CANNON.Vec3(0, 0, 0),
        };

        const wheelOffsets = [
            [-1.1, 0, -1.4], [1.1, 0, -1.4], // 前轮
            [-1.1, 0, 1.4],  [1.1, 0, 1.4]   // 后轮
        ];
        wheelOffsets.forEach(offset => {
            const options = { ...wheelOptions };
            options.chassisConnectionPointLocal = new CANNON.Vec3(offset[0], offset[1], offset[2]);
            this.vehicle.addWheel(options);
        });
        this.vehicle.addToWorld(this.world);

        // --- 3. 视觉展示 ---
        this.mesh = new THREE.Group();
        this.mesh.scale.set(1.3, 1.3, 1.3); // 放大1.3倍

        // 随机车辆类型: 0=轿车, 1=皮卡, 2=货车
        this.vehicleType = Math.floor(Math.random() * 3);

        // 随机车身颜色
        const bodyColor = new THREE.Color().setHSL(Math.random(), 0.7, 0.45);
        const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.6, roughness: 0.4 });
        const blackMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.3, roughness: 0.6 });
        const glassMat = new THREE.MeshStandardMaterial({ color: 0x88aacc, metalness: 0.9, roughness: 0.1, transparent: true, opacity: 0.6 });
        const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.1 });

        if (this.vehicleType === 0) {
            // === 轿车 ===
            // 车身底部
            const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 4.4), bodyMat);
            body.position.y = 0.3;
            body.castShadow = true;
            this.mesh.add(body);

            // 车顶
            const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.45, 2.2), bodyMat);
            roof.position.set(0, 0.75, 0.3);
            this.mesh.add(roof);

            // 前挡风玻璃
            const frontGlass = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 0.6), glassMat);
            frontGlass.position.set(0, 0.65, -0.6);
            frontGlass.rotation.x = -0.4;
            this.mesh.add(frontGlass);

            // 后挡风玻璃
            const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.35, 0.5), glassMat);
            rearGlass.position.set(0, 0.65, 1.5);
            rearGlass.rotation.x = 0.3;
            this.mesh.add(rearGlass);

            // 车灯
            const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffee, emissiveIntensity: 0.5 });
            const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.1), lightMat);
            headlight.position.set(-0.6, 0.35, -2.2);
            this.mesh.add(headlight);
            const headlight2 = headlight.clone();
            headlight2.position.set(0.6, 0.35, -2.2);
            this.mesh.add(headlight2);

            // 尾灯
            const tailMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.5 });
            const taillight = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.1), tailMat);
            taillight.position.set(-0.7, 0.35, 2.2);
            this.mesh.add(taillight);
            const taillight2 = taillight.clone();
            taillight2.position.set(0.7, 0.35, 2.2);
            this.mesh.add(taillight2);

            // 香港车牌
            const plateNumber = generateHKPlateNumber();
            const frontPlateGeo = new THREE.PlaneGeometry(1.0, 0.3);
            const frontPlateMat = new THREE.MeshBasicMaterial({ map: createPlateTexture(plateNumber, true), side: THREE.DoubleSide });
            const frontPlate = new THREE.Mesh(frontPlateGeo, frontPlateMat);
            frontPlate.position.set(0, 0.25, -2.25);
            frontPlate.rotation.y = Math.PI; // 面向前方
            this.mesh.add(frontPlate);

            const rearPlateGeo = new THREE.PlaneGeometry(1.0, 0.3);
            const rearPlateMat = new THREE.MeshBasicMaterial({ map: createPlateTexture(plateNumber, false), side: THREE.DoubleSide });
            const rearPlate = new THREE.Mesh(rearPlateGeo, rearPlateMat);
            rearPlate.position.set(0, 0.25, 2.25);
            // 不旋转，面向后方
            this.mesh.add(rearPlate);

        } else if (this.vehicleType === 1) {
            // === 皮卡 ===
            // 车头部分
            const frontBody = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.6, 2.2), bodyMat);
            frontBody.position.set(0, 0.35, -1.1);
            frontBody.castShadow = true;
            this.mesh.add(frontBody);

            // 驾驶舱
            const cabin = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 1.6), bodyMat);
            cabin.position.set(0, 0.85, -0.2);
            this.mesh.add(cabin);

            // 驾驶舱玻璃
            const cabinGlass = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 1.4), glassMat);
            cabinGlass.position.set(0, 1.0, -0.2);
            this.mesh.add(cabinGlass);

            // 前挡风
            const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.45, 0.4), glassMat);
            windshield.position.set(0, 0.9, -0.9);
            windshield.rotation.x = -0.3;
            this.mesh.add(windshield);

            // 货斗
            const bedFloor = new THREE.Mesh(new THREE.BoxGeometry(2, 0.15, 2.4), bodyMat);
            bedFloor.position.set(0, 0.4, 1.3);
            this.mesh.add(bedFloor);

            // 货斗围栏
            const bedSideL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 2.4), bodyMat);
            bedSideL.position.set(-0.95, 0.65, 1.3);
            this.mesh.add(bedSideL);
            const bedSideR = bedSideL.clone();
            bedSideR.position.set(0.95, 0.65, 1.3);
            this.mesh.add(bedSideR);
            const bedBack = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 0.1), bodyMat);
            bedBack.position.set(0, 0.65, 2.45);
            this.mesh.add(bedBack);

            // 车灯
            const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffee, emissiveIntensity: 0.5 });
            const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.2, 0.1), lightMat);
            headlight.position.set(-0.65, 0.4, -2.2);
            this.mesh.add(headlight);
            const headlight2 = headlight.clone();
            headlight2.position.set(0.65, 0.4, -2.2);
            this.mesh.add(headlight2);

            // 保险杠
            const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 0.15), chromeMat);
            bumper.position.set(0, 0.2, -2.25);
            this.mesh.add(bumper);

            // 香港车牌
            const plateNumber = generateHKPlateNumber();
            const frontPlateGeo = new THREE.PlaneGeometry(1.0, 0.3);
            const frontPlateMat = new THREE.MeshBasicMaterial({ map: createPlateTexture(plateNumber, true), side: THREE.DoubleSide });
            const frontPlate = new THREE.Mesh(frontPlateGeo, frontPlateMat);
            frontPlate.position.set(0, 0.3, -2.3);
            frontPlate.rotation.y = Math.PI;
            this.mesh.add(frontPlate);

            const rearPlateGeo = new THREE.PlaneGeometry(1.0, 0.3);
            const rearPlateMat = new THREE.MeshBasicMaterial({ map: createPlateTexture(plateNumber, false), side: THREE.DoubleSide });
            const rearPlate = new THREE.Mesh(rearPlateGeo, rearPlateMat);
            rearPlate.position.set(0, 0.3, 2.5);
            this.mesh.add(rearPlate);

        } else {
            // === 货车 ===
            // 车头
            const truckHead = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 1.8), bodyMat);
            truckHead.position.set(0, 0.5, -1.3);
            truckHead.castShadow = true;
            this.mesh.add(truckHead);

            // 驾驶舱玻璃
            const cabinGlass = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 0.6), glassMat);
            cabinGlass.position.set(0, 0.95, -1.6);
            cabinGlass.rotation.x = -0.2;
            this.mesh.add(cabinGlass);

            // 货箱
            const cargoColor = Math.random() > 0.5 ? 0xeeeeee : 0x4477aa;
            const cargoMat = new THREE.MeshStandardMaterial({ color: cargoColor, metalness: 0.2, roughness: 0.7 });
            const cargo = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.8, 3.2), cargoMat);
            cargo.position.set(0, 1.0, 0.9);
            cargo.castShadow = true;
            this.mesh.add(cargo);

            // 货箱加强筋
            const ribMat = new THREE.MeshStandardMaterial({ color: 0x666666 });
            for (let i = 0; i < 3; i++) {
                const rib = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), ribMat);
                rib.position.set(-1.18, 1.0, -0.3 + i * 1.1);
                this.mesh.add(rib);
                const rib2 = rib.clone();
                rib2.position.set(1.18, 1.0, -0.3 + i * 1.1);
                this.mesh.add(rib2);
            }

            // 车灯
            const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffee, emissiveIntensity: 0.5 });
            const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.1), lightMat);
            headlight.position.set(-0.7, 0.35, -2.2);
            this.mesh.add(headlight);
            const headlight2 = headlight.clone();
            headlight2.position.set(0.7, 0.35, -2.2);
            this.mesh.add(headlight2);

            // 尾灯
            const tailMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff3300, emissiveIntensity: 0.5 });
            const taillight = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.3, 0.1), tailMat);
            taillight.position.set(-1.0, 0.5, 2.5);
            this.mesh.add(taillight);
            const taillight2 = taillight.clone();
            taillight2.position.set(1.0, 0.5, 2.5);
            this.mesh.add(taillight2);

            // 香港车牌
            const plateNumber = generateHKPlateNumber();
            const frontPlateGeo = new THREE.PlaneGeometry(1.0, 0.3);
            const frontPlateMat = new THREE.MeshBasicMaterial({ map: createPlateTexture(plateNumber, true), side: THREE.DoubleSide });
            const frontPlate = new THREE.Mesh(frontPlateGeo, frontPlateMat);
            frontPlate.position.set(0, 0.25, -2.25);
            frontPlate.rotation.y = Math.PI;
            this.mesh.add(frontPlate);

            const rearPlateGeo = new THREE.PlaneGeometry(1.0, 0.3);
            const rearPlateMat = new THREE.MeshBasicMaterial({ map: createPlateTexture(plateNumber, false), side: THREE.DoubleSide });
            const rearPlate = new THREE.Mesh(rearPlateGeo, rearPlateMat);
            rearPlate.position.set(0, 0.25, 2.55);
            this.mesh.add(rearPlate);
        }

        this.scene.add(this.mesh);

        this.visualWheels = [];
        const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.4, 16).rotateZ(Math.PI/2);
        const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
        for(let i=0; i<4; i++) {
            const w = new THREE.Mesh(wheelGeo, wheelMat);
            this.scene.add(w);
            this.visualWheels.push(w);
        }

        // --- 4. 车顶标签 ---
        this.labelCanvas = document.createElement('canvas');
        this.labelCanvas.width = 256;
        this.labelCanvas.height = 64;
        this.labelCtx = this.labelCanvas.getContext('2d');

        const labelTexture = new THREE.CanvasTexture(this.labelCanvas);
        const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture, transparent: true });
        this.label = new THREE.Sprite(labelMaterial);
        this.label.scale.set(8, 2, 1);
        this.scene.add(this.label);
    }

    updateLabel(uid, info) {
        const ctx = this.labelCtx;
        ctx.clearRect(0, 0, 256, 64);
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px monospace';
        ctx.fillText(`#${uid}`, 10, 22);
        ctx.font = '16px monospace';
        ctx.fillText(info, 10, 50);
        this.label.material.map.needsUpdate = true;
    }

    /**
     * 行为克隆：KNN查找最相似的人类驾驶状态，返回人类的操作
     * @param {number} angleToTarget - 当前目标角度
     * @param {number} cte - 当前横向偏差
     * @param {number} speed - 当前速度
     * @param {number} pitch - 当前坡度
     * @param {Array} samples - 人类驾驶样本
     * @returns {{steer: number, acceleration: number}} 转向角和加速度
     */
    behaviorClone(angleToTarget, cte, speed, pitch, samples) {
        // 状态向量的权重
        const weights = {
            angle: 10.0,  // 角度权重最高（转向）
            cte: 2.0,     // CTE次之
            speed: 0.5,   // 速度影响较小
            pitch: 8.0    // 坡度权重高（影响油门）
        };

        // 找最近的K个邻居
        const K = 5;
        let neighbors = [];

        for (let i = 0; i < samples.length; i++) {
            const s = samples[i];
            // 计算状态距离（加权欧氏距离）
            const dAngle = (angleToTarget - s.angleToTarget) * weights.angle;
            const dCTE = (cte - s.cte) * weights.cte;
            const dSpeed = (speed - s.speed) * weights.speed;
            const dPitch = ((pitch || 0) - (s.pitch || 0)) * weights.pitch;
            const distance = dAngle * dAngle + dCTE * dCTE + dSpeed * dSpeed + dPitch * dPitch;

            if (neighbors.length < K) {
                neighbors.push({ distance, steer: s.steer, acceleration: s.acceleration || 0 });
                neighbors.sort((a, b) => a.distance - b.distance);
            } else if (distance < neighbors[K - 1].distance) {
                neighbors[K - 1] = { distance, steer: s.steer, acceleration: s.acceleration || 0 };
                neighbors.sort((a, b) => a.distance - b.distance);
            }
        }

        // 加权平均（距离越近权重越大）
        let totalWeight = 0;
        let weightedSteer = 0;
        let weightedAccel = 0;
        for (const n of neighbors) {
            const w = 1 / (n.distance + 0.001); // 避免除零
            totalWeight += w;
            weightedSteer += n.steer * w;
            weightedAccel += n.acceleration * w;
        }

        return {
            steer: weightedSteer / totalWeight,
            acceleration: weightedAccel / totalWeight
        };
    }

    /**
     * AI 驾驶核心逻辑
     */
    drive(waypoints, playerBody, allVehicles) {
        if (!this.vehicle || this.vehicle.wheelInfos.length < 4) return;

        // 稳定期：刹车等待物理稳定
        this.spawnTicks++;
        if (this.spawnTicks < this.stabilizationPeriod) {
            // 刹车保持静止
            this.vehicle.setBrake(50, 0);
            this.vehicle.setBrake(50, 1);
            this.vehicle.setBrake(50, 2);
            this.vehicle.setBrake(50, 3);
            this.vehicle.applyEngineForce(0, 2);
            this.vehicle.applyEngineForce(0, 3);
            // 同步视觉
            const pos = this.chassisBody.position;
            this.mesh.position.copy(pos);
            this.mesh.quaternion.copy(this.chassisBody.quaternion);
            for (let i = 0; i < 4; i++) {
                this.vehicle.updateWheelTransform(i);
                const t = this.vehicle.wheelInfos[i].worldTransform;
                this.visualWheels[i].position.copy(t.position);
                this.visualWheels[i].quaternion.copy(t.quaternion);
            }
            if (this.label) {
                this.label.position.set(pos.x, pos.y + 4, pos.z);
            }
            return;
        }

        // 稳定期结束，松开刹车
        if (this.spawnTicks === this.stabilizationPeriod) {
            this.vehicle.setBrake(0, 0);
            this.vehicle.setBrake(0, 1);
            this.vehicle.setBrake(0, 2);
            this.vehicle.setBrake(0, 3);
        }

        if (!waypoints || waypoints.length === 0) {
            console.error("错误：waypoints 数组为空或未定义！");
            return;
        }
        const pos = this.chassisBody.position;
        const velocity = this.chassisBody.velocity;

        // 【安全补丁：强制限速】防止物理爆炸导致瞬时速度过高
        if (velocity.length() > 60) {
            velocity.scale(0.5, velocity);
        }

        // 1. 获取目标预瞄路点 (Look-ahead) - 使用固定18米
        const lookAheadDist = this.lookAheadDist;
        let targetNode = null;
        for (let i = 0; i < waypoints.length; i++) {
            if (waypoints[i].z < pos.z - lookAheadDist) {
                targetNode = waypoints[i];
                break;
            }
        }
        if (!targetNode) {
            console.warn(`警告：Z 为 ${pos.z.toFixed(2)} 的车找不到路点了。路点范围是：${waypoints[waypoints.length-1].z} 到 ${waypoints[0].z}`);
        }
        if (!targetNode) targetNode = waypoints[waypoints.length - 1];

        // 2. 计算当前状态
        const targetX = targetNode.x + this.laneOffset;
        const worldTarget = new THREE.Vector3(targetX, targetNode.y + 0.8, targetNode.z);

        this.mesh.updateMatrixWorld();
        const invMat = new THREE.Matrix4().copy(this.mesh.matrixWorld).invert();
        const localTarget = worldTarget.clone().applyMatrix4(invMat);

        const angleToTarget = Math.atan2(localTarget.x, -localTarget.z);
        const currentSpeed = velocity.length();
        const road = calculateRoadPoint(pos.z);
        const cte = road ? pos.x - (road.x + this.laneOffset) : 0;

        // 计算当前坡度
        const aheadRoad = calculateRoadPoint(pos.z - 5);
        const pitch = (road && aheadRoad) ? Math.atan2(aheadRoad.y - road.y, 5) : 0;

        // 3. 转向和加速控制：优先使用行为克隆
        let steer = 0;
        let targetAcceleration = 0;
        const samples = window.humanDrivingSamples;

        if (samples && samples.length > 50) {
            // 行为克隆：在人类样本中找最相似的状态，使用人类的操作
            const cloned = this.behaviorClone(angleToTarget, cte, currentSpeed, pitch, samples);
            steer = cloned.steer;
            targetAcceleration = cloned.acceleration;
        } else {
            // 备用：参数控制
            steer = angleToTarget * this.steerGain;
            targetAcceleration = (this.targetSpeed - currentSpeed) * 0.5; // 温和加速
        }

        steer = THREE.MathUtils.clamp(steer, -0.6, 0.6);
        this.vehicle.setSteeringValue(steer, 0);
        this.vehicle.setSteeringValue(steer, 1);

        // 4. 智能避让：检测前方障碍
        let shouldBrake = false;
        // 避让玩家
        if (pos.distanceTo(playerBody.position) < 25 && pos.z > playerBody.position.z) shouldBrake = true;
        // 避让其他 NPC
        allVehicles.forEach(other => {
            if (other !== this && other.laneOffset === this.laneOffset) {
                const dz = pos.z - other.chassisBody.position.z;
                if (dz > 0 && dz < 20) shouldBrake = true;
            }
        });

        // 5. 动力控制：基于目标加速度
        if (shouldBrake) {
            this.vehicle.setBrake(100, 2);
            this.vehicle.setBrake(100, 3);
            this.vehicle.applyEngineForce(0, 2);
            this.vehicle.applyEngineForce(0, 3);
        } else {
            this.vehicle.setBrake(0, 2);
            this.vehicle.setBrake(0, 3);
            // 用加速度反推力：F = m * a (车重1500kg)
            // 加上一个基础力来克服阻力和坡道
            const baseForce = currentSpeed < 5 ? 1500 : 500; // 低速时给更多基础力
            const force = targetAcceleration * 1500 + baseForce;
            this.vehicle.applyEngineForce(Math.max(0, force), 2);
            this.vehicle.applyEngineForce(Math.max(0, force), 3);
        }

        // 5. 同步视觉
        this.mesh.position.copy(pos);
        this.mesh.quaternion.copy(this.chassisBody.quaternion);
        for (let i = 0; i < 4; i++) {
            this.vehicle.updateWheelTransform(i);
            const t = this.vehicle.wheelInfos[i].worldTransform;
            this.visualWheels[i].position.copy(t.position);
            this.visualWheels[i].quaternion.copy(t.quaternion);
        }
        // 更新标签位置（车顶上方）
        if (this.label) {
            this.label.position.set(pos.x, pos.y + 4, pos.z);
        }
    }

    destroy() {
        // 1. 从物理世界移除
        if (this.vehicle) {
            this.vehicle.removeFromWorld(this.world);
        }
        if (this.chassisBody) {
            this.world.removeBody(this.chassisBody);
        }

        // 2. 从视觉场景移除并释放显存 (防止卡顿)
        if (this.mesh) {
            this.mesh.traverse(child => {
                if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                }
            });
            this.scene.remove(this.mesh);
        }

        // 3. 移除视觉轮子
        if (this.visualWheels) {
            this.visualWheels.forEach(w => {
                w.geometry.dispose();
                w.material.dispose();
                this.scene.remove(w);
            });
        }
        
        // 4. 清理调试用绿球 (如果有的话)
        if (this.debugSphere) {
            this.debugSphere.geometry.dispose();
            this.debugSphere.material.dispose();
            this.scene.remove(this.debugSphere);
        }

        // 5. 移除标签
        if (this.label) {
            this.label.material.map.dispose();
            this.label.material.dispose();
            this.scene.remove(this.label);
        }
    }
}

export class TrafficManager {
    constructor(world, scene, playerBody) {
        this.world = world;
        this.scene = scene;
        this.playerBody = playerBody;
        this.vehicles = [];
        this.waypoints = [];
        this.lastWaypointZ = 0;
        
        this.limit = 6;             // 最大车数
        this.minSpacing = 50;       // 安全间距
        this.spawnTimer = 0;        
        this.spawnInterval = 90;    
    }

    update() {
        const playerZ = this.playerBody.position.z;

        // 维护路点池
        if (this.waypoints.length === 0 || this.lastWaypointZ > playerZ - 600) {
            this.generateWaypoints(playerZ);
        }

        // 智能生成
        this.spawnTimer++;
        if (this.vehicles.length < this.limit && this.spawnTimer > this.spawnInterval) {
            if (Math.random() < 0.05) {
                const potentialZ = playerZ - 60 - Math.random() * 60; // 60-120米前方
                const potentialLane = Math.random() > 0.5 ? 3.5 : -3.5;

                const safe = this.isAreaSafe(potentialZ, potentialLane);
                //console.log(`[Spawn尝试] potentialZ=${potentialZ.toFixed(0)}, lane=${potentialLane}, safe=${safe}`);

                if (safe) {
                    this.vehicles.push(new NPCVehicle(potentialZ, potentialLane, this.world, this.scene));
                    this.spawnTimer = 0;
                    //console.log(`[Spawn成功] 新车生成于 Z=${potentialZ.toFixed(0)}`);
                }
            }
        }

        // 驱动循环
        for (let i = this.vehicles.length - 1; i >= 0; i--) {
            const v = this.vehicles[i];
            v.drive(this.waypoints, this.playerBody, this.vehicles);

            const dist = v.chassisBody.position.z - playerZ;
            // 范围外回收
            if (dist > 150 || dist < -450 || v.chassisBody.position.y < -20) {
                v.destroy();
                this.vehicles.splice(i, 1);
            }
        }

        this.analyzeTraffic();
    }

    isAreaSafe(z, lane) {
        if (Math.abs(this.playerBody.position.z - z) < this.minSpacing) return false;
        for (let v of this.vehicles) {
            const dZ = Math.abs(v.chassisBody.position.z - z);
            if (v.laneOffset === lane && dZ < this.minSpacing) return false;
        }
        return true;
    }

    generateWaypoints(centerZ) {
        this.waypoints = [];
        const startZ = centerZ + 200;
        const endZ = centerZ - 800;
        for (let z = startZ; z >= endZ; z -= 4) {
            this.waypoints.push(calculateRoadPoint(z));
        }
        this.lastWaypointZ = endZ;
    }

    analyzeTraffic() {
        if (this.vehicles.length === 0 || this.spawnTimer % 60 !== 0) return;

        let totalCTE = 0;
        let maxV = 0;

        this.vehicles.forEach(v => {
            const pos = v.chassisBody.position;
            const road = calculateRoadPoint(pos.z);
            const cte = Math.abs(pos.x - (road.x + v.laneOffset));
            totalCTE += cte;
            const spd = v.chassisBody.velocity.length();
            if (spd > maxV) maxV = spd;
        });

        const avgCTE = totalCTE / this.vehicles.length;

        // console.clear();
        // console.log("%c 🚦 山路交通性能报告 ", "background: #222; color: #bada55; padding: 2px 5px;");
        // console.table({
        //     "当前 NPC 数量": this.vehicles.length,
        //     "平均横向误差 (CTE)": avgCTE.toFixed(3) + " m",
        //     "系统瞬时最高速": maxV.toFixed(2) + " m/s",
        //     "状态评级": avgCTE < 1.0 ? "✅ 稳定行驶" : "❌ 算法偏离"
        // });
    }
}
