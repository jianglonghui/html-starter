import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BaseScene } from './BaseScene.js';
import { TilesRenderer } from 'https://esm.sh/3d-tiles-renderer@0.4.19';
import { GoogleCloudAuthPlugin } from 'https://esm.sh/3d-tiles-renderer@0.4.19/plugins';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/DRACOLoader.js';

/**
 * Google Photorealistic 3D Tiles 场景
 * 使用真实城市3D模型作为场景
 */
export class Google3DTiles extends BaseScene {
    constructor(world, scene, roadMat, wallMat) {
        super(world, scene, roadMat, wallMat);
        this.roadWidth = 12;
        this.tilesRenderer = null;

        // 默认位置：旧金山市中心（有丰富的3D覆盖）
        this.centerLat = 37.7749;
        this.centerLng = -122.4194;
        this.centerAlt = 10; // 地面上10米

        // API Key - 需要用户配置
        this.apiKey = window.GOOGLE_TILES_API_KEY || '';

        // 创建一个容器用于ECEF->ENU变换
        this.tilesContainer = new THREE.Group();
        this.scene.add(this.tilesContainer);

        // 先创建固定的物理地面，让车辆可以正常生成
        this.createPhysicsGround();

        if (this.apiKey) {
            this.init3DTiles();
        } else {
            console.warn('Google 3D Tiles: 请设置 window.GOOGLE_TILES_API_KEY');
            this.createFallbackGround();
        }
    }

    /**
     * 创建固定的物理地面（在 tiles 加载前就存在）
     */
    createPhysicsGround() {
        this.dynamicGround = new CANNON.Body({ mass: 0, material: this.roadMat });
        // 使用无限平面，不需要移动，永远有效
        this.dynamicGround.addShape(new CANNON.Plane());
        // Plane 默认法向量是 Z 轴，旋转使其朝上 (Y 轴)
        this.dynamicGround.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
        this.dynamicGround.position.set(0, 0, 0); // 平面在 Y=0
        this.world.addBody(this.dynamicGround);

        // 创建路径指示线
        this.createPathIndicator();
        console.log('物理地面已创建（无限平面），Y=0');
    }

    /**
     * 创建路径指示线，显示可行驶区域
     */
    createPathIndicator() {
        // 创建一条沿Z轴的参考线
        const points = [];
        for (let z = 50; z > -500; z -= 10) {
            points.push(new THREE.Vector3(0, 0.1, z));
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineDashedMaterial({
            color: 0x00ff00,
            dashSize: 3,
            gapSize: 2,
            linewidth: 2
        });

        this.pathLine = new THREE.Line(geometry, material);
        this.pathLine.computeLineDistances();
        this.scene.add(this.pathLine);

        // 网格线已隐藏（如需调试可取消注释）
        // const gridHelper = new THREE.GridHelper(400, 40, 0x444444, 0x222222);
        // gridHelper.position.y = 0.05;
        // this.scene.add(gridHelper);
        // this.gridHelper = gridHelper;
    }

    getName() {
        return 'Google 3D 城市';
    }

    /**
     * 动态切换位置
     */
    setLocation(lat, lng, address = '') {
        this.centerLat = lat;
        this.centerLng = lng;
        this.centerAlt = 10;

        // 重置状态
        this.transformApplied = false;
        this.groundAdjusted = false;

        // 重新初始化 tiles
        if (this.tilesRenderer) {
            // 清理旧的
            this.tilesContainer.remove(this.tilesRenderer.group);
            this.tilesRenderer.dispose();
            this.tilesRenderer = null;
        }

        // 重置车辆位置
        if (window.chassisBody) {
            window.chassisBody.position.set(0, 2, -5);
            window.chassisBody.velocity.set(0, 0, 0);
            window.chassisBody.angularVelocity.set(0, 0, 0);
            window.chassisBody.quaternion.set(0, 0, 0, 1);
        }

        // 重新加载
        this.init3DTiles();

        console.log(`📍 切换位置: ${address || `${lat}, ${lng}`}`);
    }

    createRoadTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // 城市道路
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, 128, 128);

        // 车道线
        ctx.fillStyle = '#fff';
        ctx.fillRect(62, 0, 4, 25);
        ctx.fillRect(62, 45, 4, 25);
        ctx.fillRect(62, 90, 4, 38);

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    }

    /**
     * 创建ECEF到ENU（East-North-Up）的变换矩阵
     * 将地球中心坐标系转换为以指定经纬度为原点的本地坐标系
     */
    createECEFtoENUMatrix(lat, lng, alt) {
        const latRad = lat * Math.PI / 180;
        const lngRad = lng * Math.PI / 180;

        // WGS84椭球参数
        const a = 6378137.0;
        const f = 1 / 298.257223563;
        const e2 = 2 * f - f * f;

        // 计算参考点的ECEF坐标
        const sinLat = Math.sin(latRad);
        const cosLat = Math.cos(latRad);
        const sinLng = Math.sin(lngRad);
        const cosLng = Math.cos(lngRad);

        const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
        const refX = (N + alt) * cosLat * cosLng;
        const refY = (N + alt) * cosLat * sinLng;
        const refZ = (N * (1 - e2) + alt) * sinLat;

        // ECEF到ENU的旋转矩阵
        // ENU: X=East, Y=North, Z=Up
        // Three.js: X=right, Y=up, Z=forward
        // 我们需要: ENU-X->Three-X, ENU-Z->Three-Y, ENU-Y->Three-(-Z)
        const rotMatrix = new THREE.Matrix4();
        rotMatrix.set(
            -sinLng,              cosLng,               0,                 0,
            -sinLat * cosLng,     -sinLat * sinLng,     cosLat,            0,
            cosLat * cosLng,      cosLat * sinLng,      sinLat,            0,
            0,                    0,                    0,                 1
        );

        // 先平移到参考点为原点
        const translateMatrix = new THREE.Matrix4();
        translateMatrix.makeTranslation(-refX, -refY, -refZ);

        // 组合：先平移，再旋转
        const result = new THREE.Matrix4();
        result.multiplyMatrices(rotMatrix, translateMatrix);

        // 转换到Three.js坐标系（Y-up）
        // ENU是Z-up，需要旋转使Z变成Y
        const coordSwap = new THREE.Matrix4();
        coordSwap.set(
            1, 0, 0, 0,
            0, 0, 1, 0,
            0, -1, 0, 0,
            0, 0, 0, 1
        );

        const finalMatrix = new THREE.Matrix4();
        finalMatrix.multiplyMatrices(coordSwap, result);

        return finalMatrix;
    }

    init3DTiles() {
        // 使用 Google Cloud Auth Plugin 处理认证
        this.tilesRenderer = new TilesRenderer();

        // 注册 Google Cloud 认证插件
        this.tilesRenderer.registerPlugin(new GoogleCloudAuthPlugin({
            apiToken: this.apiKey,
            autoRefreshToken: true
        }));

        // 配置 GLTF 加载器
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/gltf/');

        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);

        this.tilesRenderer.manager.addHandler(/\.gltf$/i, loader);
        this.tilesRenderer.manager.addHandler(/\.glb$/i, loader);

        // 监听加载事件 - 只在第一次执行变换
        this.tilesRenderer.addEventListener('load-tile-set', () => {
            // 只执行一次
            if (this.transformApplied) return;
            this.transformApplied = true;

            console.log('Tileset 加载完成!');

            // 计算旧金山的ECEF坐标
            const ecef = this.latLngToECEF(this.centerLat, this.centerLng, this.centerAlt);
            console.log('旧金山ECEF坐标:', ecef);

            const group = this.tilesRenderer.group;

            // 旋转：让地面水平（ECEF -> ENU -> Three.js）
            const latRad = this.centerLat * Math.PI / 180;
            const lngRad = this.centerLng * Math.PI / 180;

            const east = new THREE.Vector3(-Math.sin(lngRad), Math.cos(lngRad), 0);
            const north = new THREE.Vector3(
                -Math.sin(latRad) * Math.cos(lngRad),
                -Math.sin(latRad) * Math.sin(lngRad),
                Math.cos(latRad)
            );
            const up = new THREE.Vector3(
                Math.cos(latRad) * Math.cos(lngRad),
                Math.cos(latRad) * Math.sin(lngRad),
                Math.sin(latRad)
            );

            const rotMatrix = new THREE.Matrix4();
            rotMatrix.makeBasis(east, up, north.clone().negate());
            rotMatrix.invert();
            group.setRotationFromMatrix(rotMatrix);

            // 计算平移
            const rotatedEcef = ecef.clone().applyMatrix4(rotMatrix);
            group.position.set(-rotatedEcef.x, -rotatedEcef.y, -rotatedEcef.z);

            console.log('已应用ENU变换，等待初始地面检测...');

            // 初始化：把城市整体抬到正确位置（只执行一次）
            setTimeout(() => this.adjustGroundHeight(), 2000);
        });

        this.tilesRenderer.addEventListener('load-model', (e) => {
            // 减少日志输出
            if (Math.random() < 0.1) {
                console.log('模型加载中...', e.tile?.content?.uri?.substring(0, 50));
            }
        });

        // 添加到容器，先隐藏
        this.tilesRenderer.group.visible = false;
        this.tilesContainer.add(this.tilesRenderer.group);

        console.log('Google 3D Tiles 初始化中...');
    }

    /**
     * 调整 tiles 位置，让视觉地面对齐物理地面（Y=0）
     */
    adjustGroundHeight() {
        if (this.groundAdjusted) return;
        if (!this.tilesRenderer || !this.tilesRenderer.group) return;

        // 从原点上方往下发射射线
        const raycaster = new THREE.Raycaster();
        raycaster.set(new THREE.Vector3(0, 100, 0), new THREE.Vector3(0, -1, 0));
        raycaster.far = 500;

        const intersects = raycaster.intersectObject(this.tilesRenderer.group, true);

        if (intersects.length > 0) {
            const groundY = intersects[0].point.y;
            // 让视觉地面对齐到 Y=0（物理地面顶面位置）
            const offset = -groundY;
            this.tilesRenderer.group.position.y += offset;
            this.baseGroundOffset = this.tilesRenderer.group.position.y; // 记录初始偏移作为基准
            this.groundAdjusted = true;
            // 对齐完成，显示 tiles
            this.tilesRenderer.group.visible = true;
            console.log(`Tiles已对齐并显示！偏移=${offset.toFixed(1)}米, 基准=${this.baseGroundOffset.toFixed(1)}`);
        } else {
            console.log('等待tiles加载...');
            setTimeout(() => this.adjustGroundHeight(), 1000);
        }
    }

    /**
     * 创建调试辅助物体，帮助确认坐标系
     */
    createDebugHelpers() {
        // 原点标记
        const axesHelper = new THREE.AxesHelper(50);
        this.scene.add(axesHelper);

        // 地面网格
        const gridHelper = new THREE.GridHelper(500, 50, 0x444444, 0x222222);
        gridHelper.position.y = -1;
        this.scene.add(gridHelper);

        // 添加一个临时地面让车可以行驶
        const tempGround = new THREE.Mesh(
            new THREE.PlaneGeometry(1000, 1000),
            new THREE.MeshBasicMaterial({
                color: 0x333333,
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide
            })
        );
        tempGround.rotation.x = -Math.PI / 2;
        tempGround.position.y = -0.5;
        this.scene.add(tempGround);
        this.tempGround = tempGround;

        console.log('调试辅助物体已创建');
    }

    /**
     * 经纬度转 ECEF (Earth-Centered, Earth-Fixed) 坐标
     */
    latLngToECEF(lat, lng, alt = 0) {
        const a = 6378137; // 地球赤道半径 (米)
        const f = 1 / 298.257223563; // 扁率
        const e2 = 2 * f - f * f;

        const latRad = lat * Math.PI / 180;
        const lngRad = lng * Math.PI / 180;

        const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) * Math.sin(latRad));

        const x = (N + alt) * Math.cos(latRad) * Math.cos(lngRad);
        const y = (N + alt) * Math.cos(latRad) * Math.sin(lngRad);
        const z = (N * (1 - e2) + alt) * Math.sin(latRad);

        return new THREE.Vector3(x, y, z);
    }

    setTilesPosition(lat, lng, alt) {
        if (!this.tilesRenderer) return;

        const ecef = this.latLngToECEF(lat, lng, alt);

        // 将瓦片组移动到使中心点在原点
        this.tilesRenderer.group.position.set(-ecef.x, -ecef.z, ecef.y);

        // 旋转使地面水平
        const latRad = lat * Math.PI / 180;
        const lngRad = lng * Math.PI / 180;

        this.tilesRenderer.group.rotation.set(0, 0, 0);
        this.tilesRenderer.group.rotateY(-lngRad - Math.PI / 2);
        this.tilesRenderer.group.rotateX(latRad - Math.PI / 2);
    }

    createFallbackGround() {
        // 没有 API Key 时显示简单地面
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(500, 500),
            new THREE.MeshLambertMaterial({ color: 0x555555 })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.5;
        this.scene.add(ground);

        // 提示文字
        console.log('%c Google 3D Tiles 需要 API Key', 'background: #ff6600; color: white; padding: 5px;');
        console.log('设置方法: window.GOOGLE_TILES_API_KEY = "YOUR_API_KEY"');
        console.log('获取 Key: https://console.cloud.google.com/');
    }

    /**
     * 计算路径点 - 简单直线（3D Tiles 场景中道路由模型提供）
     */
    calculateRoadPoint(z) {
        return new THREE.Vector3(0, 0, z);
    }

    generateNextSegment() {
        // Google3DTiles 场景不使用预设路段，改用动态地面
        // 只更新计数器，不生成物理体
        const i = this.segmentCounter;
        const z = -i * this.segLen;

        this.roadSegments.push({ bodies: [], meshes: [] });

        this.prevZ = z;
        this.segmentCounter++;
    }

    /**
     * 更新 3D Tiles 渲染器和动态地面
     */
    update(camera, renderer, chassisBody) {
        if (this.tilesRenderer && camera && renderer) {
            this.tilesRenderer.setCamera(camera);
            this.tilesRenderer.setResolutionFromRenderer(camera, renderer);
            this.tilesRenderer.update();
        }

        // 动态地面：跟随车位置，检测 tiles 地面高度
        if (chassisBody && this.tilesRenderer && this.transformApplied) {
            this.updateDynamicGround(chassisBody);
        }
    }

    /**
     * 更新视觉辅助元素 + 动态调整 tiles 高度使其对齐物理地面
     */
    updateDynamicGround(chassisBody) {
        const carPos = chassisBody.position;

        // 更新网格和路径线跟随车位置
        if (this.gridHelper) {
            this.gridHelper.position.set(carPos.x, 0.05, carPos.z);
        }
        if (this.pathLine) {
            this.pathLine.position.set(carPos.x, 0, carPos.z);
        }

        // 动态调整 tiles 高度：检测车下方的 tiles 地面，使其对齐 Y=0
        if (this.tilesRenderer && this.tilesRenderer.group && this.groundAdjusted) {
            this.adjustTilesHeight(carPos);
        }
    }

    /**
     * 根据车位置动态调整 tiles 高度
     */
    adjustTilesHeight(carPos) {
        // 限制检测频率（每10帧检测一次）
        this.heightCheckCounter = (this.heightCheckCounter || 0) + 1;
        if (this.heightCheckCounter % 10 !== 0) return;

        // 从车位置上方向下发射射线
        const raycaster = new THREE.Raycaster();
        raycaster.set(
            new THREE.Vector3(carPos.x, carPos.y + 50, carPos.z),
            new THREE.Vector3(0, -1, 0)
        );
        raycaster.far = 100;

        const intersects = raycaster.intersectObject(this.tilesRenderer.group, true);

        if (intersects.length > 0) {
            const tileGroundY = intersects[0].point.y;
            // 误差：当前 tiles 地面高度与目标 Y=0 的差距
            const error = tileGroundY - 0;
            // 平滑修正：将 tiles 向相反方向移动
            this.tilesRenderer.group.position.y -= error * 0.1;
        }
    }

    /**
     * 清理资源
     */
    dispose() {
        if (this.tilesRenderer) {
            this.tilesRenderer.dispose();
        }
        if (this.tilesContainer) {
            this.scene.remove(this.tilesContainer);
        }
        if (this.dynamicGround) {
            this.world.removeBody(this.dynamicGround);
        }
        if (this.pathLine) {
            this.scene.remove(this.pathLine);
            this.pathLine.geometry.dispose();
            this.pathLine.material.dispose();
        }
        if (this.gridHelper) {
            this.scene.remove(this.gridHelper);
        }
    }
}
