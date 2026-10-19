"""
RemoteMM Enterprise - Multi-Monitor Discovery & Coordinate Space Mapper
-----------------------------------------------------------------------
Discovers all connected physical displays and virtual desktop bounds using
Win32 EnumDisplayMonitors and GetSystemMetrics.

Provides:
- Monitor list with index, device name, resolution, offsets, and primary flag
- Coordinate transformation between [0.0, 1.0] normalized client inputs
  and multi-monitor desktop coordinate space (including negative offsets)
"""

import ctypes
from ctypes import wintypes

user32 = ctypes.windll.user32
user32.SetProcessDPIAware()

class RECT(ctypes.Structure):
    _fields_ = [
        ('left', wintypes.LONG),
        ('top', wintypes.LONG),
        ('right', wintypes.LONG),
        ('bottom', wintypes.LONG)
    ]

class MONITORINFOEXW(ctypes.Structure):
    _fields_ = [
        ('cbSize', wintypes.DWORD),
        ('rcMonitor', RECT),
        ('rcWork', RECT),
        ('dwFlags', wintypes.DWORD),
        ('szDevice', wintypes.WCHAR * 32)
    ]

MONITORENUMPROC = ctypes.WINFUNCTYPE(
    wintypes.BOOL,
    wintypes.HMONITOR,
    wintypes.HDC,
    ctypes.POINTER(RECT),
    wintypes.LPARAM
)

def get_virtual_desktop_bounds():
    """Returns the bounding rectangle of all monitors combined."""
    vx = user32.GetSystemMetrics(76)  # SM_XVIRTUALSCREEN
    vy = user32.GetSystemMetrics(77)  # SM_YVIRTUALSCREEN
    vw = user32.GetSystemMetrics(78)  # SM_CXVIRTUALSCREEN
    vh = user32.GetSystemMetrics(79)  # SM_CYVIRTUALSCREEN
    if vw <= 0 or vh <= 0:
        vw = user32.GetSystemMetrics(0) or 1920
        vh = user32.GetSystemMetrics(1) or 1080
        vx, vy = 0, 0
    return {
        'left': vx,
        'top': vy,
        'width': vw,
        'height': vh,
        'right': vx + vw,
        'bottom': vy + vh
    }

def enumerate_monitors():
    """Returns list of all active monitors."""
    monitors = []

    def _enum_callback(hMonitor, hdcMonitor, lprcMonitor, dwData):
        info = MONITORINFOEXW()
        info.cbSize = ctypes.sizeof(MONITORINFOEXW)
        if user32.GetMonitorInfoW(hMonitor, ctypes.byref(info)):
            r = info.rcMonitor
            w = r.right - r.left
            h = r.bottom - r.top
            is_primary = bool(info.dwFlags & 1)
            dev_name = str(info.szDevice)
            monitors.append({
                'index': len(monitors),
                'device': dev_name,
                'name': f"Monitör {len(monitors) + 1} ({w}x{h})" + (" [Ana Ekran]" if is_primary else ""),
                'left': r.left,
                'top': r.top,
                'right': r.right,
                'bottom': r.bottom,
                'width': w,
                'height': h,
                'isPrimary': is_primary
            })
        return True

    cb = MONITORENUMPROC(_enum_callback)
    user32.EnumDisplayMonitors(0, None, cb, 0)

    # Fallback if no monitor detected via enum
    if not monitors:
        vw = user32.GetSystemMetrics(0) or 1920
        vh = user32.GetSystemMetrics(1) or 1080
        monitors.append({
            'index': 0,
            'device': r'\\.\DISPLAY1',
            'name': f'Monitör 1 ({vw}x{vh}) [Ana Ekran]',
            'left': 0,
            'top': 0,
            'right': vw,
            'bottom': vh,
            'width': vw,
            'height': vh,
            'isPrimary': True
        })

    return monitors

def get_target_capture_rect(monitor_index='ALL'):
    """
    Returns (left, top, width, height) to capture based on monitor selection.
    monitor_index: 'ALL' or integer (0, 1, 2...)
    """
    monitors = enumerate_monitors()
    if monitor_index != 'ALL':
        try:
            idx = int(monitor_index)
            if 0 <= idx < len(monitors):
                m = monitors[idx]
                return m['left'], m['top'], m['width'], m['height']
        except (ValueError, TypeError):
            pass

    # Default: Virtual Desktop (All Monitors)
    vb = get_virtual_desktop_bounds()
    return vb['left'], vb['top'], vb['width'], vb['height']

def map_normalized_to_screen_coords(x_pct, y_pct, monitor_index='ALL'):
    """
    Maps normalized client mouse position [0.0, 1.0] into Win32 desktop absolute pixels,
    properly accounting for monitor offsets (including negative coordinates for left-extended displays).
    """
    x_clamped = max(0.0, min(1.0, float(x_pct)))
    y_clamped = max(0.0, min(1.0, float(y_pct)))

    left, top, w, h = get_target_capture_rect(monitor_index)
    px = int(left + (x_clamped * w))
    py = int(top + (y_clamped * h))

    return px, py

if __name__ == '__main__':
    import json
    print("Detected Monitors:")
    print(json.dumps(enumerate_monitors(), indent=2))
    print("\nVirtual Desktop Bounds:")
    print(json.dumps(get_virtual_desktop_bounds(), indent=2))
    print("\nCapture Rect for ALL:")
    print(get_target_capture_rect('ALL'))
    print("Center coordinate map:", map_normalized_to_screen_coords(0.5, 0.5, 'ALL'))
