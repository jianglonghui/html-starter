#!/bin/bash

# 启动游戏服务器
# 用法: ./start.sh

cd "$(dirname "$0")"

echo "========================================="
echo "  游戏服务器启动脚本"
echo "========================================="

# 检查 Python
if ! command -v python3 &> /dev/null; then
    echo "❌ 未找到 python3，请先安装 Python 3.8+"
    exit 1
fi

# 检查依赖
echo "📦 检查依赖..."
pip3 install -r requirements.txt -q

# 启动 API 服务 (端口 8000)
echo "🚀 启动 API 服务 (端口 8000)..."
python3 -m uvicorn enhance_server:app --host 0.0.0.0 --port 8000 &
API_PID=$!

# 启动实时同步服务 (端口 8080)
echo "🚀 启动实时同步服务 (端口 8080)..."
python3 realtime_server.py &
REALTIME_PID=$!

echo ""
echo "========================================="
echo "  服务已启动"
echo "  API 服务:    http://localhost:8000"
echo "  实时同步:    http://localhost:8080"
echo "========================================="
echo ""
echo "按 Ctrl+C 停止所有服务"

# 捕获退出信号
trap "kill $API_PID $REALTIME_PID 2>/dev/null; echo '服务已停止'; exit 0" SIGINT SIGTERM

# 等待
wait
