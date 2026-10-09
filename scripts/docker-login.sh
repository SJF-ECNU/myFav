#!/bin/sh
set -eu
case "${1:-bilibili}" in
  bilibili) login_script=login ;;
  douyin) login_script=douyin:login ;;
  xiaohongshu) login_script=xiaohongshu:login ;;
  *) echo 'Unknown platform'; exit 2 ;;
esac
if [ "${MYFAV_BROWSER:-cloakbrowser}" = cdp ]; then
  echo 'Use the external browser window to sign in; no local noVNC window is started.'
  exec npm run "$login_script"
fi
Xvfb :99 -screen 0 1366x768x24 -nolisten tcp &
xvfb_pid=$!
cleanup() {
  kill "$xvfb_pid" "${vnc_pid:-}" "${web_pid:-}" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
for attempt in 1 2 3 4 5; do
  [ -S /tmp/.X11-unix/X99 ] && break
  sleep 1
done
x11vnc -display :99 -localhost -forever -shared -nopw -rfbport 5900 > /tmp/vnc.log 2>&1 &
vnc_pid=$!
websockify --web=/usr/share/novnc 6080 localhost:5900 > /tmp/novnc.log 2>&1 &
web_pid=$!
echo 'Open http://127.0.0.1:6080/vnc.html to sign in. Keep this port private.'
npm run "$login_script"
