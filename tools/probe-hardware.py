"""Read-only Pi/USB/V4L2 inventory. Does not capture images or mark QR tests PASS.
Run on the intended board: python3 tools/probe-hardware.py
No hostname, IP, hardware serial, credentials or source records are collected.
"""
import datetime
import fcntl
import json
import os
from pathlib import Path
import platform
import shutil
import struct
import subprocess

def read(path):
    try:
        return Path(path).read_text().strip().strip('\0')
    except OSError:
        return None

def version(binary):
    executable = shutil.which(binary)
    if not executable:
        return None
    try:
        p = subprocess.run([executable, '--version'], capture_output=True, text=True, timeout=5)
        return p.stdout.strip().splitlines()[0] if p.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired, IndexError):
        return None

model = read('/proc/device-tree/model')
release = {}
for line in (read('/etc/os-release') or '').splitlines():
    key, _, value = line.partition('=')
    if key in ('NAME', 'VERSION_ID', 'VERSION_CODENAME'):
        release[key] = value.strip('"')
usb = []
for path in sorted(Path('/sys/bus/usb/devices').glob('*')):
    vendor, product = read(path/'idVendor'), read(path/'idProduct')
    if vendor and product:
        usb.append({'vendorId': vendor, 'productId': product, 'manufacturer': read(path/'manufacturer'), 'product': read(path/'product')})
cameras = []
for path in sorted(Path('/sys/class/video4linux').glob('video*')):
    result = {'node': '/dev/'+path.name, 'name': read(path/'name')}
    try:
        fd = os.open(result['node'], os.O_RDONLY | os.O_NONBLOCK)
        try:
            # Linux VIDIOC_QUERYCAP, struct v4l2_capability, 104 bytes; no image acquisition.
            data = bytearray(104)
            fcntl.ioctl(fd, 0x80685600, data)
            driver, card, bus, version_id, caps, device_caps, *reserved = struct.unpack('=16s32s32sIII3I', data)
            effective = device_caps if caps & 0x80000000 else caps
            result.update(driver=driver.split(b'\0')[0].decode(), card=card.split(b'\0')[0].decode(), videoCapture=bool(effective & (0x1 | 0x1000)), streaming=bool(effective & 0x04000000), query='OBSERVED')
        finally:
            os.close(fd)
    except OSError as error:
        result.update(query='BLOCKED', error=error.__class__.__name__, errno=error.errno)
    cameras.append(result)
space = shutil.disk_usage('.')
report = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'scope': 'Read-only hardware observations; no QR scan, reboot or power-loss validation',
          'board': {'model': model, 'isRaspberryPi': bool(model and 'Raspberry Pi' in model), 'architecture': platform.machine(), 'kernel': platform.release(), 'os': release},
          'runtime': {'node': version('node'), 'browsers': {name: version(name) for name in ('chromium', 'chromium-browser')}},
          'storage': {'freeBytes': space.free, 'totalBytes': space.total}, 'usb': usb, 'video': cameras,
          'T08': 'NOT_RUN', 'T29': 'NOT_RUN', 'status': 'OBSERVATIONS_ONLY' if model and 'Raspberry Pi' in model else 'BLOCKED_NOT_THE_PI'}
print(json.dumps(report, indent=2))
