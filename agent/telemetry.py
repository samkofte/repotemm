"""
RemoteMM Enterprise - Low-overhead Native Win32 Telemetry Collector
--------------------------------------------------------------------
Gathers real-time machine telemetry using pure Win32 APIs (no heavy dependencies):
- CPU Usage Percentage (via GetSystemTimes differential)
- Physical RAM Usage (via GlobalMemoryStatusEx)
- Disk Free Space (via GetDiskFreeSpaceExW)
- System Uptime (via GetTickCount64)
- Active User & Workstation Lock state
"""

import ctypes
import ctypes.wintypes
import os
import time

kernel32 = ctypes.windll.kernel32
user32 = ctypes.windll.user32

class MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ('dwLength', ctypes.wintypes.DWORD),
        ('dwMemoryLoad', ctypes.wintypes.DWORD),
        ('ullTotalPhys', ctypes.c_uint64),
        ('ullAvailPhys', ctypes.c_uint64),
        ('ullTotalPageFile', ctypes.c_uint64),
        ('ullAvailPageFile', ctypes.c_uint64),
        ('ullTotalVirtual', ctypes.c_uint64),
        ('ullAvailVirtual', ctypes.c_uint64),
        ('ullAvailExtendedVirtual', ctypes.c_uint64),
    ]

class FILETIME(ctypes.Structure):
    _fields_ = [
        ('dwLowDateTime', ctypes.wintypes.DWORD),
        ('dwHighDateTime', ctypes.wintypes.DWORD)
    ]

_last_idle = 0
_last_kernel = 0
_last_user = 0
_last_cpu_time = 0

def _ft_to_int(ft):
    return (ft.dwHighDateTime << 32) | ft.dwLowDateTime

def get_cpu_percent():
    """Calculates instantaneous CPU usage percentage over time deltas."""
    global _last_idle, _last_kernel, _last_user, _last_cpu_time
    idle = FILETIME()
    kernel = FILETIME()
    user = FILETIME()

    if not kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
        return 0.0

    idle_val = _ft_to_int(idle)
    kernel_val = _ft_to_int(kernel)
    user_val = _ft_to_int(user)
    now = time.time()

    if _last_cpu_time == 0:
        _last_idle = idle_val
        _last_kernel = kernel_val
        _last_user = user_val
        _last_cpu_time = now
        return 0.0

    usr_diff = user_val - _last_user
    ker_diff = kernel_val - _last_kernel
    idl_diff = idle_val - _last_idle

    _last_idle = idle_val
    _last_kernel = kernel_val
    _last_user = user_val
    _last_cpu_time = now

    total_sys = usr_diff + ker_diff
    if total_sys <= 0:
        return 0.0

    cpu = ((total_sys - idl_diff) / total_sys) * 100.0
    return round(max(0.0, min(100.0, cpu)), 1)

def get_memory_info():
    """Returns (total_mb, used_mb, free_mb, usage_percent)."""
    stat = MEMORYSTATUSEX()
    stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
    if kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
        total_mb = int(stat.ullTotalPhys / (1024 * 1024))
        free_mb = int(stat.ullAvailPhys / (1024 * 1024))
        used_mb = total_mb - free_mb
        pct = round((used_mb / total_mb) * 100.0, 1) if total_mb > 0 else 0.0
        return total_mb, used_mb, free_mb, pct
    return 0, 0, 0, 0.0

def get_disk_free_gb(path='C:\\'):
    """Returns free gigabytes on given drive."""
    free_bytes_avail = ctypes.c_uint64()
    total_bytes = ctypes.c_uint64()
    total_free_bytes = ctypes.c_uint64()

    if kernel32.GetDiskFreeSpaceExW(
        path,
        ctypes.byref(free_bytes_avail),
        ctypes.byref(total_bytes),
        ctypes.byref(total_free_bytes)
    ):
        return round(free_bytes_avail.value / (1024 ** 3), 1)
    return 0.0

def get_uptime_sec():
    """Returns system uptime in seconds."""
    try:
        ticks = kernel32.GetTickCount64()
        return int(ticks / 1000)
    except Exception:
        return 0

def is_workstation_locked():
    """Checks if current desktop is locked or switch desktop is active."""
    hdesk = user32.OpenInputDesktop(0, False, 0x0001)
    if not hdesk:
        return True
    user32.CloseDesktop(hdesk)
    return False

def collect_full_telemetry():
    """Gathers unified telemetry snapshot for NOC Dashboard."""
    total_ram, used_ram, free_ram, ram_pct = get_memory_info()
    cpu_pct = get_cpu_percent()
    free_disk = get_disk_free_gb('C:\\')
    uptime = get_uptime_sec()
    locked = is_workstation_locked()

    try:
        active_user = os.getlogin()
    except Exception:
        active_user = 'User'

    return {
        'cpuPercent': cpu_pct,
        'totalRamMb': total_ram,
        'usedRamMb': used_ram,
        'freeRamMb': free_ram,
        'ramPercent': ram_pct,
        'freeDiskGb': free_disk,
        'uptimeSec': uptime,
        'isLocked': locked,
        'activeUser': active_user,
        'timestamp': int(time.time() * 1000)
    }

if __name__ == '__main__':
    # Initial read
    get_cpu_percent()
    time.sleep(0.5)
    print("Telemetry Snapshot:")
    import json
    print(json.dumps(collect_full_telemetry(), indent=2))
