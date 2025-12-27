"""
实时同步服务器 - Socket.IO
处理车辆位置实时同步

用法：
python realtime_server.py
"""

import asyncio
import socketio
from aiohttp import web

# 创建 Socket.IO 服务器
sio = socketio.AsyncServer(
    async_mode='aiohttp',
    cors_allowed_origins='*'
)

app = web.Application()
sio.attach(app)

# 房间数据
rooms = {}  # room_id -> { players: {sid: player_data}, host_sid: str }


@sio.event
async def connect(sid, environ):
    print(f'[连接] {sid}')


@sio.event
async def disconnect(sid):
    print(f'[断开] {sid}')
    # 从所有房间移除该玩家
    for room_id, room in list(rooms.items()):
        if sid in room['players']:
            del room['players'][sid]
            await sio.emit('player_left', {'sid': sid}, room=room_id)
            print(f'[离开房间] {sid} 离开 {room_id}')

            # 如果房间空了，删除房间
            if not room['players']:
                del rooms[room_id]
                print(f'[删除房间] {room_id}')
            # 如果房主离开，转移房主
            elif room['host_sid'] == sid:
                new_host = next(iter(room['players'].keys()))
                room['host_sid'] = new_host
                await sio.emit('host_changed', {'host_sid': new_host}, room=room_id)


@sio.event
async def join_room(sid, data):
    """加入房间"""
    room_id = data.get('room_id', 'default')
    player_name = data.get('name', 'Player')

    # 创建房间或加入
    if room_id not in rooms:
        rooms[room_id] = {
            'players': {},
            'host_sid': sid
        }
        is_host = True
        print(f'[创建房间] {room_id} by {sid}')
    else:
        is_host = False

    # 加入 Socket.IO 房间
    await sio.enter_room(sid, room_id)

    # 记录玩家
    rooms[room_id]['players'][sid] = {
        'name': player_name,
        'is_driver': False,
        'position': None
    }

    # 通知房间内其他人
    await sio.emit('player_joined', {
        'sid': sid,
        'name': player_name,
        'is_host': is_host
    }, room=room_id, skip_sid=sid)

    # 返回房间信息给加入者
    return {
        'success': True,
        'room_id': room_id,
        'is_host': is_host,
        'host_sid': rooms[room_id]['host_sid'],
        'players': {
            s: {'name': p['name'], 'is_driver': p['is_driver']}
            for s, p in rooms[room_id]['players'].items()
        }
    }


@sio.event
async def claim_driver(sid, data):
    """认领驾驶员"""
    room_id = data.get('room_id')
    if room_id not in rooms or sid not in rooms[room_id]['players']:
        return {'success': False}

    # 清除之前的驾驶员
    for player in rooms[room_id]['players'].values():
        player['is_driver'] = False

    # 设置新驾驶员
    rooms[room_id]['players'][sid]['is_driver'] = True

    # 广播给房间所有人
    await sio.emit('driver_changed', {
        'driver_sid': sid,
        'driver_name': rooms[room_id]['players'][sid]['name']
    }, room=room_id)

    return {'success': True}


@sio.event
async def car_state(sid, data):
    """
    车辆状态更新 - 高频调用
    只有驾驶员发送，服务器立即广播给其他人
    """
    room_id = data.get('room_id')
    if room_id not in rooms:
        return

    # 验证是否是驾驶员
    player = rooms[room_id]['players'].get(sid)
    if not player or not player['is_driver']:
        return

    # 更新位置记录
    player['position'] = data.get('state')

    # 立即广播给房间其他人（跳过发送者）
    await sio.emit('car_state_update', {
        'state': data.get('state'),
        'timestamp': data.get('timestamp')
    }, room=room_id, skip_sid=sid)


@sio.event
async def key_event(sid, data):
    """按键事件 - 低延迟转发"""
    room_id = data.get('room_id')
    if room_id not in rooms:
        return

    # 验证是否是驾驶员
    player = rooms[room_id]['players'].get(sid)
    if not player or not player['is_driver']:
        return

    # 立即广播
    await sio.emit('key_event', {
        'key': data.get('key'),
        'is_down': data.get('is_down')
    }, room=room_id, skip_sid=sid)


@sio.event
async def scene_change(sid, data):
    """场景切换（房主）"""
    room_id = data.get('room_id')
    if room_id not in rooms:
        return

    # 只有房主可以切换场景
    if rooms[room_id]['host_sid'] != sid:
        return

    await sio.emit('scene_changed', {
        'scene_index': data.get('scene_index'),
        'location': data.get('location')
    }, room=room_id, skip_sid=sid)


@sio.event
async def traffic_state(sid, data):
    """交通车辆位置更新（房主发送，高频）"""
    room_id = data.get('room_id')
    if room_id not in rooms:
        return
    if rooms[room_id]['host_sid'] != sid:
        return

    await sio.emit('traffic_state_update', {
        'p': data.get('p', [])
    }, room=room_id, skip_sid=sid)


@sio.event
async def traffic_spawn(sid, data):
    """交通车辆生成（房主发送）"""
    room_id = data.get('room_id')
    if room_id not in rooms:
        return
    if rooms[room_id]['host_sid'] != sid:
        return

    await sio.emit('traffic_spawn', {
        'vehicle': data.get('vehicle')
    }, room=room_id, skip_sid=sid)


@sio.event
async def traffic_destroy(sid, data):
    """交通车辆销毁（房主发送）"""
    room_id = data.get('room_id')
    if room_id not in rooms:
        return
    if rooms[room_id]['host_sid'] != sid:
        return

    await sio.emit('traffic_destroy', {
        'id': data.get('id')
    }, room=room_id, skip_sid=sid)


# 健康检查
async def health(request):
    return web.json_response({'status': 'ok', 'rooms': len(rooms)})

app.router.add_get('/health', health)


if __name__ == '__main__':
    print('实时同步服务器启动: http://localhost:8080')
    web.run_app(app, host='0.0.0.0', port=8080)
