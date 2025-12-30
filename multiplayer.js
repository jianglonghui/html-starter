import { insertCoin, onPlayerJoin, myPlayer, setState, getState, isHost, RPC } from 'playroomkit';

/**
 * multiplayer.js
 * Encapsulates Playroom SDK logic for the driving game.
 */

export class MultiplayerManager {
    constructor() {
        this.players = {};
        this._myPlayer = null;
        this.currentDriverId = null;
        this.onDriverChange = null;
        this.onCarStateSync = null;
        this.onSceneChange = null; // 场景变化回调
        this.onLobbyUpdate = null; // 大厅更新回调
        this.isInitialized = false;
        this.isLobbyInitialized = false;
        this.lobbyIframe = null;
        this.pollingInterval = null;
        this.lastSceneTimestamp = 0;
        this.lastCarStateTimestamp = 0;
    }

    async init(roomCode = null) {
        console.log("Initializing Multiplayer...", roomCode ? `Room: ${roomCode}` : "Creating new room");
        try {
            const options = roomCode ? { roomCode: roomCode } : {};
            await insertCoin(options);
            console.log("Playroom insertCoin successful");
            this._myPlayer = myPlayer();
            console.log("My Player ID:", this._myPlayer?.id);
            this.isInitialized = true;

            onPlayerJoin((player) => {
                this.players[player.id] = player;
                console.log(`Player joined: ${player.getProfile().name} (ID: ${player.id})`);
            });

            // 启动状态监听
            this.startStateListeners();

            // 获取实际的房间代码（从 URL hash 中获取，Playroom 会自动设置）
            const getActualRoomCode = () => {
                const hash = window.location.hash;
                console.log("Current URL Hash:", hash);
                if (hash && hash.includes('r=')) {
                    const extracted = hash.split('r=')[1].split('&')[0];
                    console.log("Extracted from hash:", extracted);
                    return extracted;
                }
                console.log("No r= in hash, returning:", roomCode || "PLAYROOM");
                return roomCode || "PLAYROOM";
            };

            // 延迟一点显示，确保 URL 已更新
            setTimeout(() => {
                const actualCode = getActualRoomCode();
                console.log("Actual Room Code:", actualCode);
                this.showRoomCode(actualCode);
                this.saveRecentRoom(actualCode);

                // 房主在大厅广播自己的房间
                if (isHost()) {
                    setState("roomCode", actualCode, true);
                    this.advertiseRoom(actualCode);
                }
            }, 1000);

            return true;
        } catch (e) {
            console.error("Playroom initialization failed", e);
            return false;
        }
    }

    // RPC 触发式监听
    startStateListeners() {
        // 读取当前 driver 值
        const currentDriver = getState("driver");
        if (currentDriver) {
            this.currentDriverId = currentDriver;
        }

        // 注册按键事件 RPC（非驾驶员接收）
        RPC.register("keyEvent", (data, caller) => {
            console.log("RPC keyEvent received:", data.key, data.isDown);
            if (this.onKeyEvent) {
                this.onKeyEvent(data.key, data.isDown);
            }
        });

        // 注册位置校正 RPC
        RPC.register("carStateSync", (data, caller) => {
            if (this.onCarStateSync) {
                this.onCarStateSync(data);
            }
        });

        // 注册驾驶员变更 RPC
        RPC.register("driverChange", (data, caller) => {
            this.currentDriverId = data.driverId;
            const driverName = this.players[data.driverId]?.getProfile()?.name || "Unknown";
            console.log(`Driver changed: ${driverName} (ID: ${data.driverId})`);
            if (this.onDriverChange) {
                this.onDriverChange(data.driverId, driverName);
            }
        });

        // 注册场景变更 RPC（非房主接收）
        RPC.register("sceneChange", (data, caller) => {
            if (!isHost()) {
                console.log("RPC sceneChange received:", data);
                if (this.onSceneChange) {
                    this.onSceneChange(data);
                }
            }
        });

        // 注册 NPC 状态 RPC（非房主接收）
        RPC.register("npcStates", (data, caller) => {
            if (!isHost()) {
                if (this.onNPCStateChange) {
                    this.onNPCStateChange(data.vehicles);
                }
            }
        });
    }

    // 发送按键事件（驾驶员调用）
    sendKeyEvent(key, isDown) {
        if (this.isDriver()) {
            console.log(`[Driver] Sending RPC keyEvent: ${key} ${isDown ? 'DOWN' : 'UP'}`);
            RPC.call("keyEvent", { key, isDown }, RPC.Mode.OTHERS);
        }
    }

    // 发送位置校正（驾驶员调用）
    sendCarStateSync(chassisBody) {
        if (this.isDriver()) {
            // 压缩数据：使用数组代替对象，减少 Key 的开销
            const compactState = [
                chassisBody.position.x.toFixed(2), chassisBody.position.y.toFixed(2), chassisBody.position.z.toFixed(2),
                chassisBody.quaternion.x.toFixed(3), chassisBody.quaternion.y.toFixed(3), chassisBody.quaternion.z.toFixed(3), chassisBody.quaternion.w.toFixed(3),
                chassisBody.velocity.x.toFixed(1), chassisBody.velocity.y.toFixed(1), chassisBody.velocity.z.toFixed(1)
            ];

            // 只有当位置或速度有显著变化时才发送（简单频率控制已经在外部调用处处理，这里做数据压缩）
            RPC.call("carStateSync", compactState, RPC.Mode.OTHERS);
        }
    }

    isDriver() {
        return this._myPlayer && this.currentDriverId === this._myPlayer.id;
    }

    claimDriver() {
        if (this._myPlayer) {
            setState("driver", this._myPlayer.id, true);

            // 更新本地状态，确保立即生效
            this.currentDriverId = this._myPlayer.id;
            const myName = this._myPlayer.getProfile()?.name || "Me";
            console.log(`You claimed driver: ${myName} (ID: ${this._myPlayer.id})`);
            if (this.onDriverChange) {
                this.onDriverChange(this._myPlayer.id, myName);
            }

            // 立即广播驾驶员变更，缩短延迟
            RPC.call("driverChange", { driverId: this._myPlayer.id }, RPC.Mode.OTHERS);
        }
    }

    // 已移除 syncCarState 和 syncKeyEvent，改用 RPC 提高性能

    // 按键事件回调
    onKeyEvent = null;
    lastKeyEventSeq = 0;

    // 获取当前车辆状态（用于初始位置同步）
    getCarState() {
        return getState("carState");
    }

    getMyProfile() {
        return this._myPlayer ? this._myPlayer.getProfile() : null;
    }

    // 场景同步 - 房主设置场景
    setSceneInfo(sceneIndex, locationData = null) {
        if (isHost()) {
            const sceneInfo = {
                sceneIndex: sceneIndex,
                location: locationData, // { lat, lng, address } for Google 3D
                timestamp: Date.now()
            };
            setState("sceneInfo", sceneInfo, true);
            console.log("Host set scene:", sceneInfo);
        }
    }

    // 获取同步的场景信息
    getSceneInfo() {
        return getState("sceneInfo");
    }

    // 检查是否是房主
    amIHost() {
        return isHost();
    }

    // 等待场景信息（非房主用）
    waitForSceneInfo(callback, timeout = 10000) {
        const startTime = Date.now();
        const check = () => {
            const info = this.getSceneInfo();
            if (info) {
                callback(info);
            } else if (Date.now() - startTime < timeout) {
                setTimeout(check, 100);
            } else {
                console.warn("Timeout waiting for scene info");
                callback(null);
            }
        };
        check();
    }

    // ============ NPC 障碍车同步 ============

    // 房主广播 NPC 状态
    syncNPCStates(npcStates) {
        if (isHost()) {
            setState("npcStates", {
                vehicles: npcStates,
                timestamp: Date.now()
            }, true);
        }
    }

    // 获取 NPC 状态
    getNPCStates() {
        return getState("npcStates");
    }

    // 设置 NPC 状态变化回调
    onNPCStateChange = null;
    lastNPCTimestamp = 0;

    // 在轮询中检查 NPC 状态（已在 startStatePolling 中添加）

    showRoomCode(code) {
        let codeEl = document.getElementById('room-code-display');
        if (!codeEl) {
            codeEl = document.createElement('div');
            codeEl.id = 'room-code-display';
            codeEl.style.position = 'absolute';
            codeEl.style.top = '10px';
            codeEl.style.right = '10px';
            codeEl.style.color = '#fff';
            codeEl.style.zIndex = '2001';
            codeEl.style.background = 'rgba(0,0,0,0.7)';
            codeEl.style.padding = '10px 15px';
            codeEl.style.borderRadius = '8px';
            codeEl.style.fontFamily = 'monospace';
            codeEl.style.fontSize = '18px';
            codeEl.style.border = '1px solid rgba(255,255,255,0.3)';
            document.body.appendChild(codeEl);
        }
        codeEl.innerHTML = `<span style="opacity: 0.6; font-size: 12px;">房间代码</span><br>${code}`;
    }

    saveRecentRoom(code) {
        if (!code || code === "PLAYROOM") return;
        let recentRooms = JSON.parse(localStorage.getItem('recentRooms') || '[]');
        // 移除已存在的，确保它排在最前面
        recentRooms = recentRooms.filter(r => r !== code);
        recentRooms.unshift(code);
        // 只保留最近 5 个
        recentRooms = recentRooms.slice(0, 5);
        localStorage.setItem('recentRooms', JSON.stringify(recentRooms));
        console.log("Saved to recent rooms:", code);
    }

    // ============ 大厅系统 (Lobby System - Iframe Based) ============

    async initLobby() {
        if (this.isLobbyInitialized) return;
        console.log("Initializing Global Lobby via Iframe...");

        return new Promise((resolve) => {
            // 创建隐藏的 iframe
            const iframe = document.createElement('iframe');
            iframe.src = 'lobby.html';
            iframe.style.display = 'none';
            iframe.id = 'lobby-iframe';
            document.body.appendChild(iframe);
            this.lobbyIframe = iframe;

            // 监听来自 iframe 的消息
            window.addEventListener("message", (event) => {
                if (event.data.type === "LOBBY_UPDATE") {
                    if (this.onLobbyUpdate) {
                        this.onLobbyUpdate(event.data.rooms);
                    }
                }
            });

            iframe.onload = () => {
                this.isLobbyInitialized = true;
                console.log("Lobby Iframe Loaded");
                resolve(true);
            };
        });
    }

    // 房主在大厅发布自己的房间信息
    advertiseRoom(roomCode) {
        if (!this.lobbyIframe || !this._myPlayer) return;

        const hostName = this._myPlayer.getProfile()?.name || "Unknown Host";
        console.log("Advertising room to lobby iframe:", roomCode);

        const sendPing = () => {
            if (this.lobbyIframe.contentWindow) {
                this.lobbyIframe.contentWindow.postMessage({
                    type: "ADVERTISE_ROOM",
                    roomCode: roomCode,
                    hostName: hostName
                }, "*");
            }
        };

        // 立即发送并启动心跳
        sendPing();
        setInterval(sendPing, 10000);
    }
}
