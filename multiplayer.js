import { insertCoin, onPlayerJoin, myPlayer, setState, getState, isHost } from 'playroomkit';

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
        this.isInitialized = false;
        this.pollingInterval = null;
    }

    async init() {
        console.log("Initializing Multiplayer...");
        try {
            await insertCoin();
            console.log("Playroom insertCoin successful");
            this._myPlayer = myPlayer();
            this.isInitialized = true;

            onPlayerJoin((player) => {
                this.players[player.id] = player;
                console.log(`Player joined: ${player.getProfile().name} (ID: ${player.id})`);
            });

            // 启动状态轮询
            this.startStatePolling();

            return true;
        } catch (e) {
            console.error("Playroom initialization failed", e);
            return false;
        }
    }

    // 轮询状态变化
    startStatePolling() {
        this.pollingInterval = setInterval(() => {
            // 检查驾驶员变化
            const driverId = getState("driver");
            if (driverId !== this.currentDriverId) {
                this.currentDriverId = driverId;
                const driverName = this.players[driverId]?.getProfile()?.name || "Unknown";
                console.log(`Driver changed: ${driverName} (ID: ${driverId})`);
                if (this.onDriverChange) {
                    this.onDriverChange(driverId, driverName);
                }
            }

            // 检查车辆状态（非驾驶员同步）
            if (this._myPlayer && this.currentDriverId !== this._myPlayer.id) {
                const carState = getState("carState");
                if (carState && this.onCarStateSync) {
                    this.onCarStateSync(carState);
                }
            }
        }, 50); // 每50ms检查一次
    }

    isDriver() {
        return this._myPlayer && this.currentDriverId === this._myPlayer.id;
    }

    claimDriver() {
        if (this._myPlayer) {
            setState("driver", this._myPlayer.id, true);
        }
    }

    syncCarState(chassisBody) {
        if (this.isDriver()) {
            setState("carState", {
                pos: { x: chassisBody.position.x, y: chassisBody.position.y, z: chassisBody.position.z },
                quat: { x: chassisBody.quaternion.x, y: chassisBody.quaternion.y, z: chassisBody.quaternion.z, w: chassisBody.quaternion.w },
                vel: { x: chassisBody.velocity.x, y: chassisBody.velocity.y, z: chassisBody.velocity.z },
                angVel: { x: chassisBody.angularVelocity.x, y: chassisBody.angularVelocity.y, z: chassisBody.angularVelocity.z }
            }, true);
        }
    }

    getMyProfile() {
        return this._myPlayer ? this._myPlayer.getProfile() : null;
    }
}
