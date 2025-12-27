/**
 * realtimeSync.js
 * 基于 Socket.IO 的实时车辆同步
 */

export class RealtimeSync {
    constructor(serverUrl = 'http://localhost:8080') {
        this.serverUrl = serverUrl;
        this.socket = null;
        this.roomId = null;
        this.isConnected = false;
        this.isHost = false;
        this.isDriver = false;
        this.mySid = null;

        // 回调
        this.onConnect = null;
        this.onDisconnect = null;
        this.onPlayerJoined = null;
        this.onPlayerLeft = null;
        this.onDriverChanged = null;
        this.onCarStateUpdate = null;
        this.onKeyEvent = null;
        this.onSceneChanged = null;
        this.onHostChanged = null;
        this.onTrafficStateUpdate = null;
        this.onTrafficSpawn = null;
        this.onTrafficDestroy = null;

        // 发送频率控制
        this.lastSendTime = 0;
        this.sendInterval = 1000 / 60; // 60 Hz

        // 交通同步频率控制
        this.lastTrafficSendTime = 0;
        this.trafficSendInterval = 1000 / 30; // 30 Hz

        // 发包频率统计
        this.sendStats = {
            carState: { count: 0, lastReset: Date.now(), hz: 0 },
            traffic: { count: 0, lastReset: Date.now(), hz: 0 }
        };

        // 每秒输出发包统计
        setInterval(() => {
            const now = Date.now();
            const carElapsed = (now - this.sendStats.carState.lastReset) / 1000;
            const trafficElapsed = (now - this.sendStats.traffic.lastReset) / 1000;

            this.sendStats.carState.hz = (this.sendStats.carState.count / carElapsed).toFixed(1);
            this.sendStats.traffic.hz = (this.sendStats.traffic.count / trafficElapsed).toFixed(1);

            if (this.isDriver || this.isHost) {
                console.log(`[发包频率] 主车: ${this.sendStats.carState.hz} Hz | 交通: ${this.sendStats.traffic.hz} Hz`);
            }

            this.sendStats.carState.count = 0;
            this.sendStats.carState.lastReset = now;
            this.sendStats.traffic.count = 0;
            this.sendStats.traffic.lastReset = now;
        }, 1000);
    }

    /**
     * 连接服务器并加入房间
     */
    async connect(roomId, playerName = 'Player') {
        return new Promise((resolve, reject) => {
            // 动态加载 Socket.IO 客户端
            if (typeof io === 'undefined') {
                const script = document.createElement('script');
                script.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
                script.onload = () => this._initSocket(roomId, playerName, resolve, reject);
                script.onerror = () => reject(new Error('Socket.IO 加载失败'));
                document.head.appendChild(script);
            } else {
                this._initSocket(roomId, playerName, resolve, reject);
            }
        });
    }

    _initSocket(roomId, playerName, resolve, reject) {
        this.socket = io(this.serverUrl, {
            transports: ['websocket'],
            upgrade: false
        });

        this.socket.on('connect', () => {
            console.log('[RealtimeSync] 已连接服务器');
            this.isConnected = true;
            this.mySid = this.socket.id;

            // 加入房间
            this.socket.emit('join_room', {
                room_id: roomId,
                name: playerName
            }, (response) => {
                if (response.success) {
                    this.roomId = response.room_id;
                    this.isHost = response.is_host;
                    console.log(`[RealtimeSync] 加入房间 ${this.roomId}, 是否房主: ${this.isHost}`);
                    if (this.onConnect) this.onConnect(response);
                    resolve(response);
                } else {
                    reject(new Error('加入房间失败'));
                }
            });
        });

        this.socket.on('disconnect', () => {
            console.log('[RealtimeSync] 断开连接');
            this.isConnected = false;
            if (this.onDisconnect) this.onDisconnect();
        });

        this.socket.on('connect_error', (err) => {
            console.error('[RealtimeSync] 连接错误:', err.message);
            reject(err);
        });

        // 玩家加入
        this.socket.on('player_joined', (data) => {
            console.log(`[RealtimeSync] 玩家加入: ${data.name}`);
            if (this.onPlayerJoined) this.onPlayerJoined(data);
        });

        // 玩家离开
        this.socket.on('player_left', (data) => {
            console.log(`[RealtimeSync] 玩家离开: ${data.sid}`);
            if (this.onPlayerLeft) this.onPlayerLeft(data);
        });

        // 驾驶员变更
        this.socket.on('driver_changed', (data) => {
            this.isDriver = (data.driver_sid === this.mySid);
            console.log(`[RealtimeSync] 驾驶员变更: ${data.driver_name}, 是我: ${this.isDriver}, 回调存在: ${!!this.onDriverChanged}`);
            if (this.onDriverChanged) {
                this.onDriverChanged(data);
            } else {
                console.warn('[RealtimeSync] onDriverChanged 回调未设置！');
            }
        });

        // 车辆状态更新（来自驾驶员）
        this.socket.on('car_state_update', (data) => {
            if (this.onCarStateUpdate) this.onCarStateUpdate(data);
        });

        // 按键事件
        this.socket.on('key_event', (data) => {
            if (this.onKeyEvent) this.onKeyEvent(data);
        });

        // 场景变更
        this.socket.on('scene_changed', (data) => {
            console.log('[RealtimeSync] 场景变更:', data);
            if (this.onSceneChanged) this.onSceneChanged(data);
        });

        // 房主变更
        this.socket.on('host_changed', (data) => {
            this.isHost = (data.host_sid === this.mySid);
            console.log(`[RealtimeSync] 房主变更, 是我: ${this.isHost}`);
            if (this.onHostChanged) this.onHostChanged(data);
        });

        // 交通车辆状态更新（来自房主）
        this.socket.on('traffic_state_update', (data) => {
            if (this.onTrafficStateUpdate) this.onTrafficStateUpdate(data);
        });

        // 交通车辆生成（来自房主）
        this.socket.on('traffic_spawn', (data) => {
            if (this.onTrafficSpawn) this.onTrafficSpawn(data);
        });

        // 交通车辆销毁（来自房主）
        this.socket.on('traffic_destroy', (data) => {
            if (this.onTrafficDestroy) this.onTrafficDestroy(data);
        });
    }

    /**
     * 认领驾驶员
     */
    claimDriver() {
        if (!this.socket || !this.roomId) return;

        this.socket.emit('claim_driver', {
            room_id: this.roomId
        }, (response) => {
            if (response.success) {
                this.isDriver = true;
                console.log('[RealtimeSync] 已认领驾驶员');
            }
        });
    }

    /**
     * 发送车辆状态（驾驶员调用）
     * 带频率限制
     */
    sendCarState(chassisBody) {
        if (!this.socket || !this.roomId || !this.isDriver) return;

        const now = Date.now();
        if (now - this.lastSendTime < this.sendInterval) return;
        this.lastSendTime = now;

        this.sendStats.carState.count++;
        // 移除 volatile，确保包不被丢弃
        this.socket.emit('car_state', {
            room_id: this.roomId,
            state: {
                pos: { x: chassisBody.position.x, y: chassisBody.position.y, z: chassisBody.position.z },
                quat: { x: chassisBody.quaternion.x, y: chassisBody.quaternion.y, z: chassisBody.quaternion.z, w: chassisBody.quaternion.w },
                vel: { x: chassisBody.velocity.x, y: chassisBody.velocity.y, z: chassisBody.velocity.z },
                angVel: { x: chassisBody.angularVelocity.x, y: chassisBody.angularVelocity.y, z: chassisBody.angularVelocity.z }
            },
            timestamp: now
        });
    }

    /**
     * 发送按键事件（驾驶员调用）
     */
    sendKeyEvent(key, isDown) {
        if (!this.socket || !this.roomId || !this.isDriver) return;

        this.socket.emit('key_event', {
            room_id: this.roomId,
            key: key,
            is_down: isDown
        });
    }

    /**
     * 发送场景变更（房主调用）
     */
    sendSceneChange(sceneIndex, location = null) {
        if (!this.socket || !this.roomId || !this.isHost) return;

        this.socket.emit('scene_change', {
            room_id: this.roomId,
            scene_index: sceneIndex,
            location: location
        });
    }

    /**
     * 发送交通车辆位置（房主调用，高频）
     */
    sendTrafficPositions(positions) {
        if (!this.socket || !this.roomId || !this.isHost) return;

        const now = Date.now();
        if (now - this.lastTrafficSendTime < this.trafficSendInterval) return;
        this.lastTrafficSendTime = now;

        this.sendStats.traffic.count++;
        const payload = {
            room_id: this.roomId,
            p: positions
        };
        // 统计包大小
        if (!this.trafficPacketLogged) {
            const size = JSON.stringify(payload).length;
            console.log(`[Traffic包] 车辆数: ${positions.length}, 大小: ${size} bytes`);
            this.trafficPacketLogged = true;
            setTimeout(() => this.trafficPacketLogged = false, 5000); // 每5秒打印一次
        }
        // 移除 volatile，确保交通包不被丢弃
        this.socket.emit('traffic_state', payload);
    }

    /**
     * 发送交通车辆生成（房主调用，事件触发）
     */
    sendTrafficSpawn(vehicleData) {
        if (!this.socket || !this.roomId || !this.isHost) return;

        this.socket.emit('traffic_spawn', {
            room_id: this.roomId,
            vehicle: vehicleData
        });
    }

    /**
     * 发送交通车辆销毁（房主调用，事件触发）
     */
    sendTrafficDestroy(vehicleId) {
        if (!this.socket || !this.roomId || !this.isHost) return;

        this.socket.emit('traffic_destroy', {
            room_id: this.roomId,
            id: vehicleId
        });
    }

    /**
     * 设置同步频率
     */
    setSendRate(hz) {
        this.sendInterval = 1000 / hz;
    }

    /**
     * 断开连接
     */
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.isConnected = false;
        this.roomId = null;
    }
}
