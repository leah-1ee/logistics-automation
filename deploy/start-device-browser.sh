#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
umask 077
profile="$project_root/var/browser-profile"
mkdir -p "$profile"
chmod 700 "$profile"
browser="${LOGISTICS_CHROMIUM:-chromium}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
args=(--password-store=basic --user-data-dir="$profile" --no-first-run --no-default-browser-check
  --disable-background-networking --disable-component-update
  --disable-features=WebRtcPipeWireCamera,OptimizationHints,OptimizationGuideModelDownloading,OptimizationGuideOnDeviceModel,Translate,MediaRouter)
if [[ -S "$XDG_RUNTIME_DIR/${WAYLAND_DISPLAY:-wayland-0}" ]]; then
  export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
  args+=(--ozone-platform=wayland)
fi
# Optional local diagnostic endpoint; not enabled for ordinary operation.
if [[ "${LOGISTICS_BROWSER_DEBUG:-0}" == 1 ]]; then
  args+=(--remote-debugging-address=127.0.0.1 --remote-debugging-port=0)
fi
exec "$browser" "${args[@]}" http://127.0.0.1:3200/device
