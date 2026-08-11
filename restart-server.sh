#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-4173}"
HOST="${PHOTO_WALL_HOST:-0.0.0.0}"
PID_FILE="$PROJECT_DIR/.photo-wall-server-$PORT.pid"
LOG_FILE="$PROJECT_DIR/photo-wall-server-$PORT.log"

if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
    echo "错误：端口必须是 1～65535 之间的整数。" >&2
    exit 2
fi

listener_pids() {
    if command -v lsof >/dev/null 2>&1; then
        lsof -t -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
    elif command -v fuser >/dev/null 2>&1; then
        fuser "$PORT/tcp" 2>/dev/null || true
    else
        echo "错误：需要安装 lsof 或 fuser 才能安全识别占用端口的进程。" >&2
        exit 1
    fi
}

mapfile -t OLD_PIDS < <(listener_pids)

if (( ${#OLD_PIDS[@]} > 0 )); then
    for pid in "${OLD_PIDS[@]}"; do
        pid="${pid//[[:space:]]/}"
        [[ -n "$pid" ]] || continue
        command_line="$(ps -p "$pid" -o args= 2>/dev/null || true)"
        if [[ "$command_line" != *"python3 -m http.server $PORT"* &&
              "$command_line" != *"python -m http.server $PORT"* ]]; then
            echo "错误：端口 $PORT 被其他程序占用，未自动终止：" >&2
            echo "  PID $pid  $command_line" >&2
            exit 1
        fi
    done

    echo "正在停止端口 $PORT 上的旧服务（PID: ${OLD_PIDS[*]}）…"
    kill "${OLD_PIDS[@]}"

    for _ in {1..50}; do
        mapfile -t REMAINING_PIDS < <(listener_pids)
        (( ${#REMAINING_PIDS[@]} == 0 )) && break
        sleep 0.1
    done

    mapfile -t REMAINING_PIDS < <(listener_pids)
    for pid in "${REMAINING_PIDS[@]}"; do
        echo "旧服务未及时释放端口，强制终止 PID $pid。"
        kill -KILL "$pid"
    done
fi

echo "正在启动 Photo Wall 服务…"
nohup python3 -m http.server "$PORT" --bind "$HOST" --directory "$PROJECT_DIR" \
    >"$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" >"$PID_FILE"

for _ in {1..50}; do
    if ! kill -0 "$NEW_PID" 2>/dev/null; then
        echo "错误：服务启动失败，日志如下：" >&2
        tail -n 20 "$LOG_FILE" >&2 || true
        exit 1
    fi
    if command -v curl >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
        echo "服务已启动：http://localhost:$PORT/"
        echo "PID: $NEW_PID"
        echo "日志：$LOG_FILE"
        exit 0
    fi
    sleep 0.1
done

echo "错误：服务启动后未能通过访问检查，请查看日志：$LOG_FILE" >&2
exit 1
