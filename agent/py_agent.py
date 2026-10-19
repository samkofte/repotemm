"""
RemoteMM Agent v4.0 - Gercek Windows Servisi
--------------------------------------------------
SCM (Service Control Manager) modunda:
  pywin32 ServiceFramework ile RegisterServiceCtrlHandler() cagirir
  SERVICE_RUNNING rapor eder → SCM mutlu
  WTSQueryUserToken + CreateProcessAsUser ile kullanici oturumunda --server baslatir
  Watchdog: server olmediyse 5 saniyede yeniden baslatir

--server modunda:
  GDI32 ile ekran yakala, TCP 6129 uzerinden stream et
  SendInput ile fare/klavye kontrolu
"""

import sys, os, time, json, socket, threading, io, ctypes, ctypes.wintypes, base64, queue, winsound
try:
    import tkinter as tk
    from tkinter import scrolledtext
except Exception:
    pass

try:
    from identity import load_or_create_identity
except Exception:
    def load_or_create_identity():
        return {'hwid': 'fallback_hwid', 'deviceToken': 'fallback_token', 'tenantId': 'tenant_default'}

try:
    from telemetry import collect_full_telemetry
except Exception:
    def collect_full_telemetry():
        return {'cpuPercent': 0.0, 'usedRamMb': 0, 'totalRamMb': 0, 'freeDiskGb': 0.0, 'uptimeSec': 0}


kernel32 = ctypes.windll.kernel32
userenv  = ctypes.windll.userenv
wtsapi32 = ctypes.windll.wtsapi32
user32   = ctypes.windll.user32
gdi32    = ctypes.windll.gdi32

PORT       = 6129
AGENT_PATH = os.path.abspath(sys.executable if getattr(sys, 'frozen', False) else __file__)

# ─── Windows Yapilari ────────────────────────────────────────
class STARTUPINFO(ctypes.Structure):
    _fields_ = [
        ('cb',              ctypes.c_ulong),
        ('lpReserved',      ctypes.c_wchar_p),
        ('lpDesktop',       ctypes.c_wchar_p),
        ('lpTitle',         ctypes.c_wchar_p),
        ('dwX',             ctypes.c_ulong), ('dwY', ctypes.c_ulong),
        ('dwXSize',         ctypes.c_ulong), ('dwYSize', ctypes.c_ulong),
        ('dwXCountChars',   ctypes.c_ulong), ('dwYCountChars', ctypes.c_ulong),
        ('dwFillAttribute', ctypes.c_ulong),
        ('dwFlags',         ctypes.c_ulong),
        ('wShowWindow',     ctypes.c_ushort),
        ('cbReserved2',     ctypes.c_ushort),
        ('lpReserved2',     ctypes.c_void_p),
        ('hStdInput',       ctypes.c_void_p),
        ('hStdOutput',      ctypes.c_void_p),
        ('hStdError',       ctypes.c_void_p),
    ]

class PROCESS_INFORMATION(ctypes.Structure):
    _fields_ = [
        ('hProcess', ctypes.c_void_p), ('hThread', ctypes.c_void_p),
        ('dwProcessId', ctypes.c_ulong), ('dwThreadId', ctypes.c_ulong),
    ]

class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ('biSize', ctypes.c_uint32), ('biWidth', ctypes.c_int32),
        ('biHeight', ctypes.c_int32), ('biPlanes', ctypes.c_uint16),
        ('biBitCount', ctypes.c_uint16), ('biCompression', ctypes.c_uint32),
        ('biSizeImage', ctypes.c_uint32), ('biXPelsPerMeter', ctypes.c_int32),
        ('biYPelsPerMeter', ctypes.c_int32), ('biClrUsed', ctypes.c_uint32),
        ('biClrImportant', ctypes.c_uint32),
    ]

# ─── WTS / Kullanici Oturumu Launcher & SAS ───────────────────────
advapi32 = ctypes.windll.advapi32
kernel32 = ctypes.windll.kernel32
wtsapi32 = ctypes.windll.wtsapi32

kernel32.GetCurrentProcess.restype = ctypes.c_void_p
advapi32.OpenProcessToken.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p)]
advapi32.OpenProcessToken.restype = ctypes.c_int32
advapi32.DuplicateTokenEx.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_int32, ctypes.c_int32, ctypes.POINTER(ctypes.c_void_p)]
advapi32.DuplicateTokenEx.restype = ctypes.c_int32
advapi32.SetTokenInformation.argtypes = [ctypes.c_void_p, ctypes.c_int32, ctypes.c_void_p, ctypes.c_uint32]
advapi32.SetTokenInformation.restype = ctypes.c_int32
advapi32.CreateProcessAsUserW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_bool, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_void_p, ctypes.c_void_p]
advapi32.CreateProcessAsUserW.restype = ctypes.c_int32

class PROCESSENTRY32(ctypes.Structure):
    _fields_ = [
        ('dwSize', ctypes.wintypes.DWORD), ('cntUsage', ctypes.wintypes.DWORD),
        ('th32ProcessID', ctypes.wintypes.DWORD), ('th32DefaultHeapID', ctypes.c_void_p),
        ('th32ModuleID', ctypes.wintypes.DWORD), ('cntThreads', ctypes.wintypes.DWORD),
        ('th32ParentProcessID', ctypes.wintypes.DWORD), ('pcPriClassBase', ctypes.c_long),
        ('dwFlags', ctypes.wintypes.DWORD), ('szExeFile', ctypes.c_char * 260)
    ]

def enable_all_privileges():
    """Gereken tum sistem ayricaliklarini (Tcb, PrimaryToken, Debug, Shutdown) aktif eder."""
    try:
        import winreg
        with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System", 0, winreg.KEY_SET_VALUE) as k:
            winreg.SetValueEx(k, "SoftwareSASGeneration", 0, winreg.REG_DWORD, 3)
            winreg.SetValueEx(k, "PromptOnSecureDesktop", 0, winreg.REG_DWORD, 0)
    except: pass

    try:
        hToken = ctypes.c_void_p()
        if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), 0x0020 | 0x0008, ctypes.byref(hToken)):
            return
        class LUID(ctypes.Structure):
            _fields_ = [('LowPart', ctypes.wintypes.DWORD), ('HighPart', ctypes.wintypes.LONG)]
        class LUID_AND_ATTRIBUTES(ctypes.Structure):
            _fields_ = [('Luid', LUID), ('Attributes', ctypes.wintypes.DWORD)]
        class TOKEN_PRIVILEGES(ctypes.Structure):
            _fields_ = [('PrivilegeCount', ctypes.wintypes.DWORD), ('Privileges', LUID_AND_ATTRIBUTES * 1)]

        for priv in ['SeTcbPrivilege', 'SeAssignPrimaryTokenPrivilege', 'SeIncreaseQuotaPrivilege', 'SeDebugPrivilege', 'SeShutdownPrivilege']:
            luid = LUID()
            if advapi32.LookupPrivilegeValueW(None, priv, ctypes.byref(luid)):
                tp = TOKEN_PRIVILEGES()
                tp.PrivilegeCount = 1
                tp.Privileges[0].Luid = luid
                tp.Privileges[0].Attributes = 0x00000002 # SE_PRIVILEGE_ENABLED
                advapi32.AdjustTokenPrivileges(hToken, False, ctypes.byref(tp), 0, None, None)
        kernel32.CloseHandle(hToken)
    except: pass

def get_active_session():
    """Aktif konsol veya etkilesimli kullanici oturum kimligini dondurur."""
    # 1. explorer.exe oturumu (kullanicinin masaustu oturumu - en dogru ve stabil olan)
    try:
        hSnap = kernel32.CreateToolhelp32Snapshot(2, 0)
        pe = PROCESSENTRY32()
        pe.dwSize = ctypes.sizeof(PROCESSENTRY32)
        if kernel32.Process32First(hSnap, ctypes.byref(pe)):
            while True:
                name = pe.szExeFile.decode('latin1', errors='ignore').lower()
                if 'explorer.exe' in name:
                    s = ctypes.wintypes.DWORD()
                    kernel32.ProcessIdToSessionId(pe.th32ProcessID, ctypes.byref(s))
                    if s.value > 0:
                        kernel32.CloseHandle(hSnap)
                        return s.value
                if not kernel32.Process32Next(hSnap, ctypes.byref(pe)): break
        kernel32.CloseHandle(hSnap)
    except: pass

    # 2. Standart aktif konsol oturumu
    try:
        sess = kernel32.WTSGetActiveConsoleSessionId()
        if sess != 0xFFFFFFFF and sess > 0:
            return sess
    except: pass

    # 3. winlogon / logonui (kilit ekrani oturumu)
    try:
        hSnap = kernel32.CreateToolhelp32Snapshot(2, 0)
        pe = PROCESSENTRY32()
        pe.dwSize = ctypes.sizeof(PROCESSENTRY32)
        if kernel32.Process32First(hSnap, ctypes.byref(pe)):
            while True:
                name = pe.szExeFile.decode('latin1', errors='ignore').lower()
                if any(x in name for x in ['logonui.exe', 'winlogon.exe']):
                    s = ctypes.wintypes.DWORD()
                    kernel32.ProcessIdToSessionId(pe.th32ProcessID, ctypes.byref(s))
                    if s.value > 0:
                        kernel32.CloseHandle(hSnap)
                        return s.value
                if not kernel32.Process32Next(hSnap, ctypes.byref(pe)): break
        kernel32.CloseHandle(hSnap)
    except: pass
    return 1

def get_system_token_for_session(session_id):
    """Hedef oturum icin Winlogon/LogonUI veya SYSTEM tokenini elde eder."""
    # Strateji 1: Oturumdaki winlogon veya logonui surecinden token al (En garantili)
    try:
        hSnap = kernel32.CreateToolhelp32Snapshot(2, 0)
        pe = PROCESSENTRY32()
        pe.dwSize = ctypes.sizeof(PROCESSENTRY32)
        target_pids = []
        if kernel32.Process32First(hSnap, ctypes.byref(pe)):
            while True:
                name = pe.szExeFile.decode('latin1', errors='ignore').lower()
                s = ctypes.wintypes.DWORD()
                kernel32.ProcessIdToSessionId(pe.th32ProcessID, ctypes.byref(s))
                if s.value == session_id:
                    target_pids.append((name, pe.th32ProcessID))
                if not kernel32.Process32Next(hSnap, ctypes.byref(pe)): break
        kernel32.CloseHandle(hSnap)

        order = ['winlogon.exe', 'logonui.exe', 'csrss.exe', 'explorer.exe', 'taskhostw.exe']
        target_pids.sort(key=lambda x: (order.index(x[0]) if x[0] in order else 999))

        for name, pid in target_pids:
            hProc = kernel32.OpenProcess(0x1000 | 0x0400, False, pid)
            if hProc:
                hTok = ctypes.c_void_p()
                if advapi32.OpenProcessToken(hProc, 0x0002 | 0x0004 | 0x0008, ctypes.byref(hTok)):
                    hDup = ctypes.c_void_p()
                    if advapi32.DuplicateTokenEx(hTok, 0xF01FF, None, 2, 1, ctypes.byref(hDup)):
                        kernel32.CloseHandle(hTok)
                        kernel32.CloseHandle(hProc)
                        return hDup
                    kernel32.CloseHandle(hTok)
                kernel32.CloseHandle(hProc)
    except: pass

    # Strateji 2: WTSQueryUserToken
    try:
        hTok = ctypes.c_void_p()
        if wtsapi32.WTSQueryUserToken(session_id, ctypes.byref(hTok)):
            hDup = ctypes.c_void_p()
            if advapi32.DuplicateTokenEx(hTok, 0xF01FF, None, 2, 1, ctypes.byref(hDup)):
                kernel32.CloseHandle(hTok)
                return hDup
            kernel32.CloseHandle(hTok)
    except: pass

    # Strateji 3: Kendi SYSTEM tokenini klonlayip SessionId set et
    try:
        hToken = ctypes.c_void_p()
        if advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), 0xF01FF, ctypes.byref(hToken)):
            hTokenDup = ctypes.c_void_p()
            if advapi32.DuplicateTokenEx(hToken, 0xF01FF, None, 2, 1, ctypes.byref(hTokenDup)):
                kernel32.CloseHandle(hToken)
                sess_id = ctypes.c_uint32(session_id)
                advapi32.SetTokenInformation(hTokenDup, 12, ctypes.byref(sess_id), ctypes.sizeof(sess_id))
                return hTokenDup
            kernel32.CloseHandle(hToken)
    except: pass
    return None

def launch_in_user_session(flag='--server'):
    """SYSTEM veya normal yetkiyle calisirken hedef oturumda surec baslatir."""
    session_id = get_active_session()
    if session_id == 0xFFFFFFFF:
        session_id = 1
        
    token = get_system_token_for_session(session_id)
    if not token:
        try:
            exe = AGENT_PATH if getattr(sys, 'frozen', False) else sys.executable
            args = [exe, flag] if getattr(sys, 'frozen', False) else [exe, AGENT_PATH, flag]
            subprocess.Popen(args)
            return True
        except:
            return False

    env_block = ctypes.c_void_p()
    userenv.CreateEnvironmentBlock(ctypes.byref(env_block), token, False)

    if getattr(sys, 'frozen', False):
        cmd_str = f'"{AGENT_PATH}" {flag}'
    else:
        cmd_str = f'"{sys.executable}" "{AGENT_PATH}" {flag}'

    desktops_to_try = ["WinSta0\\Default", "WinSta0\\Winlogon", ""]
    ok = False
    last_err = 0
    pi = PROCESS_INFORMATION()

    for d in desktops_to_try:
        si = STARTUPINFO()
        si.cb          = ctypes.sizeof(STARTUPINFO)
        si.lpDesktop   = d
        si.dwFlags     = 0x00000001
        si.wShowWindow = 1 if flag == '--chat-ui' else 0

        cmd_buf = ctypes.create_unicode_buffer(cmd_str)
        creation_flags = 0x00000400
        if flag == '--server':
            creation_flags |= 0x08000000
        ok = advapi32.CreateProcessAsUserW(
            token, None, cmd_buf, None, None, False,
            creation_flags,
            env_block if env_block else None,
            None, ctypes.byref(si), ctypes.byref(pi)
        )
        if ok:
            kernel32.CloseHandle(pi.hProcess)
            kernel32.CloseHandle(pi.hThread)
            break
        else:
            last_err = kernel32.GetLastError()

    if env_block: userenv.DestroyEnvironmentBlock(env_block)
    kernel32.CloseHandle(token)

    log_file = os.path.join(os.path.dirname(AGENT_PATH), "agent_debug.log")
    try:
        with open(log_file, "a") as f:
            if ok:
                f.write(f"[{time.time()}] Launched {flag} in session {session_id} successfully.\n")
            else:
                f.write(f"[{time.time()}] CreateProcessAsUserW for {flag} failed in session {session_id} (err={last_err}).\n")
    except: pass
    return bool(ok)

def launch_server_in_user_session():
    return launch_in_user_session('--server')

def launch_chat_in_user_session():
    # Eger ajan su anda zaten interaktif kullanici oturumundaysa (Session > 0), direkt baslat
    try:
        curr_sess = ctypes.c_ulong()
        kernel32.ProcessIdToSessionId(kernel32.GetCurrentProcessId(), ctypes.byref(curr_sess))
        if curr_sess.value > 0:
            exe = AGENT_PATH if getattr(sys, 'frozen', False) else sys.executable
            args = [exe, '--chat-ui'] if getattr(sys, 'frozen', False) else [exe, AGENT_PATH, '--chat-ui']
            subprocess.Popen(args)
            return True
    except:
        pass
    return launch_in_user_session('--chat-ui')

def server_running():
    try:
        s = socket.socket(); s.settimeout(1)
        s.connect(('127.0.0.1', PORT)); s.close(); return True
    except: return False

def watchdog_loop():
    """Arka planda calisir: server yoksa veya aktif oturum degistiyse yeniden baslatir."""
    enable_all_privileges()
    log_file = os.path.join(os.path.dirname(AGENT_PATH), "agent_debug.log")
    os.system('netsh advfirewall firewall delete rule name=RemoteMMAgent >nul 2>&1')
    os.system(f'netsh advfirewall firewall add rule name=RemoteMMAgent dir=in action=allow protocol=TCP localport={PORT} >nul 2>&1')
    last_launch = 0
    stable_session = get_active_session()
    candidate_session = stable_session
    candidate_count = 0
    try:
        with open(log_file, "a") as f: f.write(f"[{time.time()}] Watchdog started in session {stable_session}.\n")
    except: pass

    while True:
        try:
            curr_sess = get_active_session()
            now = time.time()
            if curr_sess != 0xFFFFFFFF and curr_sess > 0:
                if curr_sess != stable_session:
                    if curr_sess == candidate_session:
                        candidate_count += 1
                    else:
                        candidate_session = curr_sess
                        candidate_count = 1
                    
                    if candidate_count >= 5:
                        try:
                            with open(log_file, "a") as f:
                                f.write(f"[{time.time()}] Session switched from {stable_session} to {curr_sess}. Restarting server.\n")
                        except: pass
                        stable_session = curr_sess
                        candidate_count = 0
                        os.system('taskkill /F /IM RemoteMM_Agent.exe /FI "SESSION ne 0" >nul 2>&1')
                        time.sleep(1)
                        if launch_server_in_user_session():
                            last_launch = now
                else:
                    candidate_count = 0
                    if not server_running() and (now - last_launch > 3):
                        try:
                            with open(log_file, "a") as f:
                                f.write(f"[{time.time()}] Server not running in session {curr_sess}. Restarting server.\n")
                        except: pass
                        if launch_server_in_user_session():
                            last_launch = now
            time.sleep(1)
        except Exception as e:
            try:
                with open(log_file, "a") as f: f.write(f"[{time.time()}] Watchdog error: {e}\n")
            except: pass
            time.sleep(2)



user32.SetProcessDPIAware()

def get_scr():
    w = user32.GetSystemMetrics(0)
    h = user32.GetSystemMetrics(1)
    return (w if w > 0 else 1920), (h if h > 0 else 1080)

def get_desk_name(h):
    if not h: return ''
    buf = ctypes.create_unicode_buffer(256)
    need = ctypes.c_ulong()
    if user32.GetUserObjectInformationW(h, 2, buf, ctypes.sizeof(buf), ctypes.byref(need)):
        return buf.value
    return ''

CURRENT_DESK = [None]
def switch_desktop():
    try:
        hwinsta = user32.OpenWindowStationW("WinSta0", False, 0x000F037F)
        if hwinsta:
            user32.SetProcessWindowStation(hwinsta)
    except: pass

    for desk_name in (None, "Default", "Winlogon"):
        try:
            if desk_name is None:
                hdesk = user32.OpenInputDesktop(0, False, 0x02000000 | 0x0001 | 0x0040)
            else:
                hdesk = user32.OpenDesktopW(desk_name, 0, False, 0x02000000 | 0x0001 | 0x0040)
            if hdesk:
                user32.SetThreadDesktop(hdesk)
                if CURRENT_DESK[0] and CURRENT_DESK[0] != hdesk:
                    try: user32.CloseDesktop(CURRENT_DESK[0])
                    except: pass
                CURRENT_DESK[0] = hdesk
                return True
        except: pass
    return False

LAST_DESK_CHECK = [0]
LAST_FRAME_B64 = [None]

def check_and_switch_desktop():
    """Eger aktif input desktop (ekrandaki goruntu) thread'in desktop'indan farkliysa gecis yapar."""
    t_now = time.time()
    if t_now - LAST_DESK_CHECK[0] < 2.0:
        return False
    LAST_DESK_CHECK[0] = t_now
    try:
        h_in = user32.OpenInputDesktop(0, False, 0x02000000 | 0x0001 | 0x0040)
        if h_in:
            in_name = get_desk_name(h_in)
            user32.CloseDesktop(h_in)
            h_cur = user32.GetThreadDesktop(kernel32.GetCurrentThreadId())
            cur_name = get_desk_name(h_cur)
            if in_name and in_name != cur_name:
                switch_desktop()
                return True
    except: pass
    return False

GDI_CACHE = {'hdc_mem': None, 'hbmp': None, 'w': 0, 'h': 0, 'buf': None, 'bmi': None}

def reset_gdi_cache():
    if GDI_CACHE['hdc_mem']:
        try:
            gdi32.DeleteObject(GDI_CACHE['hbmp'])
            gdi32.DeleteDC(GDI_CACHE['hdc_mem'])
        except: pass
    GDI_CACHE['hdc_mem'] = None
    GDI_CACHE['hbmp'] = None
    GDI_CACHE['w'] = 0
    GDI_CACHE['h'] = 0
    GDI_CACHE['buf'] = None
    GDI_CACHE['bmi'] = None

def capture_gdi(quality=78):
    try:
        if check_and_switch_desktop():
            reset_gdi_cache()

        from PIL import Image
        w, h = get_scr()
        hdc = user32.GetDC(0)
        if not hdc:
            switch_desktop()
            reset_gdi_cache()
            hdc = user32.GetDC(0)
            if not hdc: return LAST_FRAME_B64[0]

        stride = (w * 3 + 3) & ~3
        if GDI_CACHE['w'] != w or GDI_CACHE['h'] != h or not GDI_CACHE['hdc_mem']:
            reset_gdi_cache()
            GDI_CACHE['hdc_mem'] = gdi32.CreateCompatibleDC(hdc)
            GDI_CACHE['hbmp'] = gdi32.CreateCompatibleBitmap(hdc, w, h)
            gdi32.SelectObject(GDI_CACHE['hdc_mem'], GDI_CACHE['hbmp'])
            GDI_CACHE['w'] = w
            GDI_CACHE['h'] = h
            GDI_CACHE['buf'] = ctypes.create_string_buffer(stride * h)
            bmi = BITMAPINFOHEADER()
            bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
            bmi.biWidth = w; bmi.biHeight = -h
            bmi.biPlanes = 1; bmi.biBitCount = 24; bmi.biCompression = 0
            GDI_CACHE['bmi'] = bmi

        # 0x40CC0020 = SRCCOPY (0x00CC0020) | CAPTUREBLT (0x40000000)
        # CAPTUREBLT sayesinde DWM/DirectX/video ve seffaf katman pencereleri siyah olmadan yakalanir
        ok = gdi32.BitBlt(GDI_CACHE['hdc_mem'], 0, 0, w, h, hdc, 0, 0, 0x40CC0020)
        user32.ReleaseDC(0, hdc)
        if not ok:
            # Video veya DWM pencere gecisinde BitBlt teklemesinde onceki kareyi koru
            return LAST_FRAME_B64[0]

        gdi32.GetDIBits(GDI_CACHE['hdc_mem'], GDI_CACHE['hbmp'], 0, h, GDI_CACHE['buf'], ctypes.byref(GDI_CACHE['bmi']), 0)

        img = Image.frombuffer('RGB', (w, h), GDI_CACHE['buf'], 'raw', 'BGR', stride, 1)
        out = io.BytesIO()
        img.save(out, format='JPEG', quality=quality)
        frame_b64 = base64.b64encode(out.getvalue()).decode()
        LAST_FRAME_B64[0] = frame_b64
        return frame_b64
    except Exception as e:
        return LAST_FRAME_B64[0]

def capture_thumbnail(max_w=320, max_h=180, quality=40):
    """NOC paneli grid onizlemesi icin dusuk cozunurluklu, hafif kare yakalar."""
    try:
        from PIL import Image
        frame_b64 = capture_gdi(quality=50)
        if not frame_b64:
            return None
        raw_bytes = base64.b64decode(frame_b64)
        im = Image.open(io.BytesIO(raw_bytes))
        im.thumbnail((max_w, max_h), Image.Resampling.BILINEAR)
        out = io.BytesIO()
        im.save(out, format='JPEG', quality=quality)
        return base64.b64encode(out.getvalue()).decode()
    except Exception:
        return None

# ─── Input ───────────────────────────────────────────────────

MOUSEEVENTF_LEFTDOWN=0x0002; MOUSEEVENTF_LEFTUP=0x0004
MOUSEEVENTF_RIGHTDOWN=0x0008; MOUSEEVENTF_RIGHTUP=0x0010
MOUSEEVENTF_MIDDLEDOWN=0x0020; MOUSEEVENTF_MIDDLEUP=0x0040
MOUSEEVENTF_WHEEL=0x0800; MOUSEEVENTF_MOVE=0x0001; MOUSEEVENTF_ABSOLUTE=0x8000
KEYEVENTF_KEYUP=0x0002; INPUT_MOUSE=0; INPUT_KEYBOARD=1
VK_CTRL=0x11; VK_ALT=0x12; VK_DEL=0x2E; VK_WIN=0x5B
VK_TAB=0x09; VK_RET=0x0D; VK_ESC=0x1B; VK_F4=0x73

class MI(ctypes.Structure):
    _fields_=[('dx',ctypes.c_long),('dy',ctypes.c_long),('mouseData',ctypes.c_ulong),
              ('dwFlags',ctypes.c_ulong),('time',ctypes.c_ulong),
              ('dwExtraInfo',ctypes.c_size_t)]
class KI(ctypes.Structure):
    _fields_=[('wVk',ctypes.c_ushort),('wScan',ctypes.c_ushort),
              ('dwFlags',ctypes.c_ulong),('time',ctypes.c_ulong),
              ('dwExtraInfo',ctypes.c_size_t)]
class IU(ctypes.Union):
    _fields_=[('mi',MI),('ki',KI)]
class INP(ctypes.Structure):
    _fields_=[('type',ctypes.c_ulong),('_input',IU)]

MAGIC_REMOTE_TAG = 0x524D4D

class MSLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ('pt', ctypes.wintypes.POINT),
        ('mouseData', ctypes.wintypes.DWORD),
        ('flags', ctypes.wintypes.DWORD),
        ('time', ctypes.wintypes.DWORD),
        ('dwExtraInfo', ctypes.c_size_t)
    ]

class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ('vkCode', ctypes.wintypes.DWORD),
        ('scanCode', ctypes.wintypes.DWORD),
        ('flags', ctypes.wintypes.DWORD),
        ('time', ctypes.wintypes.DWORD),
        ('dwExtraInfo', ctypes.c_size_t)
    ]

HOOK_MOUSE = [None]
HOOK_KBD = [None]
LOCKED = False
BLACKOUT = False
CURTAIN_HWND = [None]

CLIENTS_LOCK = threading.Lock()
ACTIVE_CLIENTS = []
CHAT_HISTORY = []
CHAT_PROC = [None]
CHAT_LOCK = threading.Lock()

AUDIO_QUEUE = queue.Queue(maxsize=100)

def audio_playback_worker():
    while True:
        try:
            data = AUDIO_QUEUE.get()
            if data is None: break
            winsound.PlaySound(data, winsound.SND_MEMORY)
            AUDIO_QUEUE.task_done()
        except Exception:
            pass

threading.Thread(target=audio_playback_worker, daemon=True).start()

HOOKPROC_M = ctypes.WINFUNCTYPE(ctypes.c_longlong, ctypes.c_int, ctypes.c_size_t, ctypes.POINTER(MSLLHOOKSTRUCT))
HOOKPROC_K = ctypes.WINFUNCTYPE(ctypes.c_longlong, ctypes.c_int, ctypes.c_size_t, ctypes.POINTER(KBDLLHOOKSTRUCT))
user32.SetWindowsHookExW.restype = ctypes.wintypes.HHOOK
user32.SetWindowsHookExW.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.wintypes.HINSTANCE, ctypes.wintypes.DWORD]
user32.CallNextHookEx.restype = ctypes.c_longlong
user32.CallNextHookEx.argtypes = [ctypes.wintypes.HHOOK, ctypes.c_int, ctypes.c_size_t, ctypes.c_void_p]

def hook_mouse_proc(nCode, wParam, lParam):
    if nCode >= 0 and LOCKED:
        try:
            info = ctypes.cast(lParam, ctypes.POINTER(MSLLHOOKSTRUCT)).contents
            if (info.flags & 1) or (info.dwExtraInfo == MAGIC_REMOTE_TAG):
                return user32.CallNextHookEx(None, nCode, wParam, lParam)
            return 1
        except: pass
    return user32.CallNextHookEx(None, nCode, wParam, lParam)

def hook_kbd_proc(nCode, wParam, lParam):
    if nCode >= 0 and LOCKED:
        try:
            info = ctypes.cast(lParam, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents
            if (info.flags & 0x10) or (info.dwExtraInfo == MAGIC_REMOTE_TAG):
                return user32.CallNextHookEx(None, nCode, wParam, lParam)
            return 1
        except: pass
    return user32.CallNextHookEx(None, nCode, wParam, lParam)

CB_MOUSE = HOOKPROC_M(hook_mouse_proc)
CB_KBD = HOOKPROC_K(hook_kbd_proc)

def set_curtain_window(state):
    global BLACKOUT
    BLACKOUT = bool(state)

def input_and_curtain_manager():
    switch_desktop()
    hmod = kernel32.GetModuleHandleW(None)
    HOOK_MOUSE[0] = user32.SetWindowsHookExW(14, CB_MOUSE, hmod, 0)
    HOOK_KBD[0] = user32.SetWindowsHookExW(13, CB_KBD, hmod, 0)
    msg = ctypes.wintypes.MSG()
    while True:
        try:
            if BLACKOUT and not CURTAIN_HWND[0]:
                switch_desktop()
                w, h = get_scr()
                hwnd = user32.CreateWindowExW(
                    0x00000008 | 0x00000080, 'STATIC', '',
                    0x80000000 | 0x10000000 | 0x04,
                    0, 0, w, h, 0, 0, 0, None
                )
                if hwnd:
                    try: user32.SetWindowDisplayAffinity(hwnd, 0x00000011)
                    except: pass
                    CURTAIN_HWND[0] = hwnd
                user32.PostMessageW(0xFFFF, 0x0112, 0xF170, 2)
            elif not BLACKOUT and CURTAIN_HWND[0]:
                try: user32.DestroyWindow(CURTAIN_HWND[0])
                except: pass
                CURTAIN_HWND[0] = None
                user32.PostMessageW(0xFFFF, 0x0112, 0xF170, -1)

            while user32.PeekMessageW(ctypes.byref(msg), 0, 0, 0, 1):
                user32.TranslateMessage(ctypes.byref(msg))
                user32.DispatchMessageW(ctypes.byref(msg))
            time.sleep(0.015)
        except:
            time.sleep(0.05)

def ms(flags, dx=0, dy=0, data=0):
    try:
        user32.SetMessageExtraInfo(MAGIC_REMOTE_TAG)
        i=INP(); i.type=INPUT_MOUSE; i._input.mi=MI()
        i._input.mi.dx=dx; i._input.mi.dy=dy
        i._input.mi.mouseData=data; i._input.mi.dwFlags=flags
        i._input.mi.time=0
        i._input.mi.dwExtraInfo=MAGIC_REMOTE_TAG
        user32.SendInput(1, ctypes.byref(i), ctypes.sizeof(INP))
    except: pass

def ks(vk, flags=0):
    try:
        user32.SetMessageExtraInfo(MAGIC_REMOTE_TAG)
        i=INP(); i.type=INPUT_KEYBOARD; i._input.ki=KI()
        i._input.ki.wVk=vk; i._input.ki.wScan=0
        i._input.ki.dwFlags=flags; i._input.ki.time=0
        i._input.ki.dwExtraInfo=MAGIC_REMOTE_TAG
        user32.SendInput(1, ctypes.byref(i), ctypes.sizeof(INP))
    except: pass

def do_mouse(cmd):
    try:
        x=float(cmd.get('xPercent',0)); y=float(cmd.get('yPercent',0))
        act=cmd.get('action',''); btn=cmd.get('button','left'); dlt=int(cmd.get('delta',0))
        ax=int(x*65535); ay=int(y*65535)
        w, h = get_scr()
        user32.SetMessageExtraInfo(MAGIC_REMOTE_TAG)
        user32.SetCursorPos(int(x * w), int(y * h))
        ms(MOUSEEVENTF_MOVE|MOUSEEVENTF_ABSOLUTE, ax, ay)
        if   act=='mousedown':
            if btn=='right': ms(MOUSEEVENTF_RIGHTDOWN)
            elif btn=='middle': ms(MOUSEEVENTF_MIDDLEDOWN)
            else: ms(MOUSEEVENTF_LEFTDOWN)
        elif act=='mouseup':
            if btn=='right': ms(MOUSEEVENTF_RIGHTUP)
            elif btn=='middle': ms(MOUSEEVENTF_MIDDLEUP)
            else: ms(MOUSEEVENTF_LEFTUP)
        elif act=='click':
            if btn=='right': ms(MOUSEEVENTF_RIGHTDOWN); ms(MOUSEEVENTF_RIGHTUP)
            elif btn=='middle': ms(MOUSEEVENTF_MIDDLEDOWN); ms(MOUSEEVENTF_MIDDLEUP)
            else: ms(MOUSEEVENTF_LEFTDOWN); ms(MOUSEEVENTF_LEFTUP)
        elif act=='dblclick':
            ms(MOUSEEVENTF_LEFTDOWN); ms(MOUSEEVENTF_LEFTUP)
            time.sleep(0.05)
            ms(MOUSEEVENTF_LEFTDOWN); ms(MOUSEEVENTF_LEFTUP)
        elif act=='scroll':
            ms(MOUSEEVENTF_WHEEL, data=dlt*120)
    except: pass

def do_key(cmd):
    # Remote admin input is NOT blocked by LOCKED (BlockInput blocks physical local user only)
    try:
        k=cmd.get('key','')
        if not k: return
        if k in ('CAD', '{CAD}'):
            try:
                sas = ctypes.windll.LoadLibrary('sas.dll')
                sas.SendSAS(False)
            except: pass
            ks(VK_CTRL); ks(VK_ALT); ks(VK_DEL); time.sleep(0.05)
            ks(VK_DEL,KEYEVENTF_KEYUP); ks(VK_ALT,KEYEVENTF_KEYUP); ks(VK_CTRL,KEYEVENTF_KEYUP)
        elif k in ('UNLOCK', 'DISMISS_LOCK'):
            try:
                sas = ctypes.windll.LoadLibrary('sas.dll')
                sas.SendSAS(False)
            except: pass
            ks(VK_RET); time.sleep(0.04); ks(VK_RET, KEYEVENTF_KEYUP)
            time.sleep(0.04)
            ks(0x20); time.sleep(0.04); ks(0x20, KEYEVENTF_KEYUP)
        elif k in ('TASK_MGR', '{TASK_MGR}'):
            os.system('start taskmgr.exe')
        elif k in ('WIN_KEY', 'Meta', 'OS', '{WIN}', 'Win'):
            ks(VK_WIN); time.sleep(0.08); ks(VK_WIN,KEYEVENTF_KEYUP)
        elif k in ('WIN_L', '{WIN_L}'): user32.LockWorkStation()
        elif k in ('WIN_TAB', '{WIN_TAB}'):
            ks(VK_WIN); ks(VK_TAB); time.sleep(0.05)
            ks(VK_TAB,KEYEVENTF_KEYUP); ks(VK_WIN,KEYEVENTF_KEYUP)
        elif k in ('ALT_TAB', '{ALT_TAB}'):
            ks(VK_ALT); ks(VK_TAB); time.sleep(0.05)
            ks(VK_TAB,KEYEVENTF_KEYUP); ks(VK_ALT,KEYEVENTF_KEYUP)
        elif k in ('ALT_F4', '{ALT_F4}'):
            ks(VK_ALT); ks(VK_F4); time.sleep(0.05)
            ks(VK_F4,KEYEVENTF_KEYUP); ks(VK_ALT,KEYEVENTF_KEYUP)
        elif k in ('ESC', '{ESC}', 'Escape'): ks(VK_ESC); time.sleep(0.05); ks(VK_ESC,KEYEVENTF_KEYUP)
        elif k in ('ENTER', '{ENTER}', 'Enter'): ks(VK_RET); time.sleep(0.02); ks(VK_RET,KEYEVENTF_KEYUP)
        elif k in ('BACKSPACE', '{BACKSPACE}', 'Backspace'): ks(0x08); time.sleep(0.02); ks(0x08,KEYEVENTF_KEYUP)
        elif k in ('TAB', '{TAB}', 'Tab'): ks(VK_TAB); time.sleep(0.02); ks(VK_TAB,KEYEVENTF_KEYUP)
        elif k in ('DELETE', '{DELETE}', 'Delete'): ks(VK_DEL); time.sleep(0.02); ks(VK_DEL,KEYEVENTF_KEYUP)
        elif k in ('UP', '{UP}', 'ArrowUp'): ks(0x26); time.sleep(0.02); ks(0x26,KEYEVENTF_KEYUP)
        elif k in ('DOWN', '{DOWN}', 'ArrowDown'): ks(0x28); time.sleep(0.02); ks(0x28,KEYEVENTF_KEYUP)
        elif k in ('LEFT', '{LEFT}', 'ArrowLeft'): ks(0x25); time.sleep(0.02); ks(0x25,KEYEVENTF_KEYUP)
        elif k in ('RIGHT', '{RIGHT}', 'ArrowRight'): ks(0x27); time.sleep(0.02); ks(0x27,KEYEVENTF_KEYUP)
        elif k in ('HOME', '{HOME}', 'Home'): ks(0x24); time.sleep(0.02); ks(0x24,KEYEVENTF_KEYUP)
        elif k in ('END', '{END}', 'End'): ks(0x23); time.sleep(0.02); ks(0x23,KEYEVENTF_KEYUP)
        elif k in ('PAGEUP', '{PAGEUP}', 'PageUp'): ks(0x21); time.sleep(0.02); ks(0x21,KEYEVENTF_KEYUP)
        elif k in ('PAGEDOWN', '{PAGEDOWN}', 'PageDown'): ks(0x22); time.sleep(0.02); ks(0x22,KEYEVENTF_KEYUP)
        elif k in ('INSERT', '{INSERT}', 'Insert'): ks(0x2D); time.sleep(0.02); ks(0x2D,KEYEVENTF_KEYUP)
        elif k in ('PRTSCN', '{PRTSCN}', 'PrintScreen'): ks(0x2C); time.sleep(0.05); ks(0x2C,KEYEVENTF_KEYUP)
        elif k=='UAC_YES': ks(VK_RET); time.sleep(0.05); ks(VK_RET,KEYEVENTF_KEYUP)
        elif k=='UAC_NO':  ks(VK_ESC); time.sleep(0.05); ks(VK_ESC,KEYEVENTF_KEYUP)
        elif k.startswith('F') and k[1:].isdigit():
            fn=int(k[1:])
            if 1<=fn<=12:
                vk=0x6F+fn; ks(vk); time.sleep(0.02); ks(vk,KEYEVENTF_KEYUP)
        elif len(k)==1:
            vk=user32.VkKeyScanW(ord(k))
            lo=vk&0xFF; hi=(vk>>8)&0xFF
            if hi&1: ks(0x10)
            if hi&2: ks(VK_CTRL)
            if hi&4: ks(VK_ALT)
            ks(lo); time.sleep(0.02); ks(lo,KEYEVENTF_KEYUP)
            if hi&4: ks(VK_ALT,KEYEVENTF_KEYUP)
            if hi&2: ks(VK_CTRL,KEYEVENTF_KEYUP)
            if hi&1: ks(0x10,KEYEVENTF_KEYUP)
    except: pass

def get_drives():
    drives = []
    try:
        import string
        bitmask = kernel32.GetLogicalDrives()
        for letter in string.ascii_uppercase:
            if bitmask & 1:
                drives.append(f"{letter}:\\")
            bitmask >>= 1
    except:
        drives = ['C:\\']
    return drives or ['C:\\']

CONN_SEND_LOCKS = {}
CONN_SEND_MUTEX = threading.Lock()

def send_json_safe(conn, obj):
    try:
        data = (json.dumps(obj) + '\n').encode('utf-8')
        with CONN_SEND_MUTEX:
            if conn not in CONN_SEND_LOCKS:
                CONN_SEND_LOCKS[conn] = threading.Lock()
            lk = CONN_SEND_LOCKS[conn]
        with lk:
            conn.sendall(data)
        return True
    except:
        return False

def handle_fs(conn, cmd):
    t = cmd.get('type', '')
    try:
        if t == 'FS_LIST':
            req_path = cmd.get('path', 'C:\\')
            if not req_path or req_path == '.':
                req_path = 'C:\\'
            req_path = os.path.abspath(req_path)
            drives = get_drives()
            entries = []
            if os.path.exists(req_path) and os.path.isdir(req_path):
                try:
                    with os.scandir(req_path) as it:
                        for entry in it:
                            try:
                                is_dir = entry.is_dir(follow_symlinks=False)
                                stat = entry.stat(follow_symlinks=False)
                                mtime = time.strftime('%Y-%m-%d %H:%M', time.localtime(stat.st_mtime))
                                entries.append({
                                    'name': entry.name,
                                    'isDirectory': is_dir,
                                    'size': stat.st_size if not is_dir else 0,
                                    'modified': mtime
                                })
                            except: pass
                except: pass
            entries.sort(key=lambda x: (not x['isDirectory'], x['name'].lower()))
            res = {
                'type': 'FS_LIST_RES',
                'path': req_path,
                'drives': drives,
                'entries': entries
            }
            send_json_safe(conn, res)

        elif t == 'FS_DOWNLOAD':
            fpath = cmd.get('path', '')
            if os.path.isfile(fpath):
                sz = os.path.getsize(fpath)
                if sz > 25 * 1024 * 1024:
                    send_json_safe(conn, {'type':'FS_ERROR','message':'Dosya 25MB sinirini asiyor.'})
                    return
                with open(fpath, 'rb') as f:
                    content = f.read()
                b64 = base64.b64encode(content).decode('ascii')
                res = {
                    'type': 'FS_DOWNLOAD_RES',
                    'path': fpath,
                    'filename': os.path.basename(fpath),
                    'data': b64,
                    'size': sz
                }
                send_json_safe(conn, res)

        elif t == 'FS_UPLOAD':
            fpath = cmd.get('path', '')
            b64_data = cmd.get('data', '')
            content = base64.b64decode(b64_data)
            parent = os.path.dirname(os.path.abspath(fpath))
            if parent: os.makedirs(parent, exist_ok=True)
            with open(fpath, 'wb') as f:
                f.write(content)
            res = {'type': 'FS_UPLOAD_RES', 'path': fpath, 'success': True}
            send_json_safe(conn, res)

        elif t == 'FS_DELETE':
            fpath = cmd.get('path', '')
            if os.path.isdir(fpath):
                import shutil
                shutil.rmtree(fpath, ignore_errors=True)
            elif os.path.isfile(fpath):
                os.remove(fpath)
            res = {'type': 'FS_DELETE_RES', 'path': fpath, 'success': True}
            send_json_safe(conn, res)

        elif t == 'FS_MKDIR':
            fpath = cmd.get('path', '')
            os.makedirs(fpath, exist_ok=True)
            res = {'type': 'FS_MKDIR_RES', 'path': fpath, 'success': True}
            send_json_safe(conn, res)

        elif t == 'FS_EXEC':
            fpath = cmd.get('path', '')
            os.system(f'start "" "{fpath}"')
            res = {'type': 'FS_EXEC_RES', 'path': fpath, 'success': True}
            send_json_safe(conn, res)
    except Exception as e:
        send_json_safe(conn, {'type':'FS_ERROR','message':str(e)})

def handle_task_list(conn):
    try:
        import subprocess
        cmd = 'powershell -NoProfile -Command "Get-Process | Select-Object -First 50 Id, ProcessName, @{Name=\'CPU\';Expression={$_.CPU}}, WorkingSet64 | ConvertTo-Json"'
        out = subprocess.check_output(cmd, shell=True, timeout=5).decode('utf-8', errors='ignore')
        procs = json.loads(out)
        if isinstance(procs, dict): procs = [procs]
        formatted = []
        for p in procs:
            formatted.append({
                'Id': p.get('Id', 0),
                'ProcessName': p.get('ProcessName', 'Unknown') + '.exe',
                'CPU': f"{round(float(p.get('CPU') or 0), 1)}%",
                'WorkingSet64': int(p.get('WorkingSet64') or 0),
                'User': 'SYSTEM'
            })
        send_json_safe(conn, {'type':'TASK_LIST_RES','processes':formatted})
    except: pass

CHAT_IPC_PORT = 6131
CHAT_IPC_CLIENTS = []
CHAT_IPC_LOCK = threading.Lock()

def start_chat_ipc_server():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        for _ in range(15):
            try:
                s.bind(('127.0.0.1', CHAT_IPC_PORT))
                break
            except:
                time.sleep(0.5)
        else:
            return
        s.listen(5)
        while True:
            try:
                c, _ = s.accept()
                with CHAT_IPC_LOCK:
                    CHAT_IPC_CLIENTS.append(c)
                # Send current chat history immediately to connecting chat UI
                send_json_safe(c, {'type': 'CHAT_SYNC', 'messages': list(CHAT_HISTORY)})
                threading.Thread(target=handle_chat_ipc_client, args=(c,), daemon=True).start()
            except:
                time.sleep(0.2)
    except:
        pass

def handle_chat_ipc_client(conn):
    buf = ''
    while True:
        try:
            data = conn.recv(4096)
            if not data: break
            buf += data.decode('utf-8', errors='ignore')
            lines = buf.split('\n'); buf = lines.pop()
            for line in lines:
                line = line.strip()
                if not line: continue
                try: msg = json.loads(line)
                except: continue
                if msg.get('type') == 'USER_MESSAGE':
                    text = msg.get('text', '').strip()
                    if text:
                        t_now = msg.get('time', time.strftime('%H:%M:%S'))
                        try: uname = os.getlogin()
                        except: uname = 'User'
                        msg_obj = {
                            'sender': f'Remote User ({uname})',
                            'text': text,
                            'time': t_now
                        }
                        CHAT_HISTORY.append(msg_obj)
                        broadcast_chat()
                        broadcast_to_chat_ui({'type': 'CHAT_SYNC', 'messages': list(CHAT_HISTORY)})
        except:
            break
    with CHAT_IPC_LOCK:
        if conn in CHAT_IPC_CLIENTS:
            CHAT_IPC_CLIENTS.remove(conn)
    try: conn.close()
    except: pass

def broadcast_to_chat_ui(payload):
    with CHAT_IPC_LOCK:
        for c in list(CHAT_IPC_CLIENTS):
            send_json_safe(c, payload)

def broadcast_chat():
    payload = {'type': 'CHAT_BROADCAST', 'messages': list(CHAT_HISTORY)}
    with CLIENTS_LOCK:
        for c in list(ACTIVE_CLIENTS):
            send_json_safe(c, payload)

def ensure_chat_ui():
    """Kullanici masaustunde Chat UI penceresini baslatir veya one getirir."""
    with CHAT_IPC_LOCK:
        if len(CHAT_IPC_CLIENTS) > 0:
            broadcast_to_chat_ui({'type': 'SHOW_WINDOW'})
            return True
    return launch_chat_in_user_session()

def run_chat_ui():
    import tkinter as tk
    from tkinter import scrolledtext

    # Connect to local agent chat IPC
    sock = None
    for _ in range(30):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.connect(('127.0.0.1', CHAT_IPC_PORT))
            sock = s
            break
        except:
            time.sleep(0.2)

    root = tk.Tk()
    root.title('RemoteMM - Uzak Destek & Operatör Sohbeti')
    root.geometry('400x520')
    root.configure(bg='#0f172a')
    root.attributes('-topmost', True)
    root.minsize(340, 420)

    try:
        sw = root.winfo_screenwidth()
        sh = root.winfo_screenheight()
        root.geometry(f"400x520+{sw - 425}+{sh - 570}")
    except: pass

    # Header
    h_frame = tk.Frame(root, bg='#1e293b', pady=10, padx=12)
    h_frame.pack(fill='x')

    top_row = tk.Frame(h_frame, bg='#1e293b')
    top_row.pack(fill='x')
    tk.Label(top_row, text='RemoteMM Uzak Destek', font=('Segoe UI', 11, 'bold'), fg='#38bdf8', bg='#1e293b').pack(side='left')
    tk.Label(top_row, text='● Canli', font=('Segoe UI', 9, 'bold'), fg='#22c55e', bg='#1e293b').pack(side='right')

    tk.Label(h_frame, text='Teknisyen baglandi • Canli iletisim oturumu', font=('Segoe UI', 8), fg='#94a3b8', bg='#1e293b').pack(anchor='w', pady=(2, 0))

    # Messages
    txt = scrolledtext.ScrolledText(root, wrap='word', bg='#0f172a', fg='#e2e8f0', font=('Segoe UI', 9), bd=0, padx=10, pady=10)
    txt.pack(fill='both', expand=True, padx=8, pady=8)
    txt.tag_config('tech_hdr', foreground='#38bdf8', font=('Segoe UI', 9, 'bold'))
    txt.tag_config('user_hdr', foreground='#4ade80', font=('Segoe UI', 9, 'bold'))
    txt.tag_config('sys_hdr', foreground='#64748b', font=('Segoe UI', 8, 'italic'))
    txt.tag_config('body', foreground='#f1f5f9', font=('Segoe UI', 9))
    txt.config(state='disabled')

    def add_msg(sender, text, time_str, tag='user_hdr'):
        txt.config(state='normal')
        txt.insert('end', f'[{time_str}] {sender}:\n', tag)
        txt.insert('end', f'{text}\n\n', 'body')
        txt.config(state='disabled')
        txt.see('end')

    add_msg('Sistem', 'Destek oturumu baslatildi. Teknisyene dogrudan buradan cevap yazabilirsiniz.', time.strftime('%H:%M:%S'), 'sys_hdr')

    # Input Frame
    b_frame = tk.Frame(root, bg='#1e293b', pady=10, padx=10)
    b_frame.pack(fill='x', side='bottom')

    entry = tk.Entry(b_frame, bg='#0f172a', fg='#f8fafc', insertbackground='#38bdf8', font=('Segoe UI', 10), bd=1, relief='solid')
    entry.pack(side='left', fill='x', expand=True, padx=(0, 8), ipady=5)

    def on_send():
        val = entry.get().strip()
        if val and sock:
            entry.delete(0, 'end')
            t_now = time.strftime('%H:%M:%S')
            add_msg('Siz', val, t_now, 'user_hdr')
            try:
                payload = json.dumps({'type': 'USER_MESSAGE', 'text': val, 'time': t_now}) + '\n'
                sock.sendall(payload.encode('utf-8'))
            except: pass

    entry.bind('<Return>', lambda e: on_send())

    btn = tk.Button(b_frame, text='Gonder', font=('Segoe UI', 9, 'bold'), bg='#0284c7', fg='white', activebackground='#0369a1', activeforeground='white', bd=0, padx=14, pady=5, cursor='hand2', command=on_send)
    btn.pack(side='right')

    def handle_incoming(cmd):
        t = cmd.get('type')
        if t == 'CHAT_INCOMING':
            sndr = cmd.get('sender', 'Teknisyen')
            txt_msg = cmd.get('text', '')
            t_str = cmd.get('time', time.strftime('%H:%M:%S'))
            add_msg(sndr, txt_msg, t_str, 'tech_hdr')
            root.deiconify()
            root.lift()
            root.attributes('-topmost', True)
            root.after(400, lambda: root.attributes('-topmost', False))
            entry.focus_set()
            try: user32.MessageBeep(0x00000040)
            except: pass
        elif t == 'CHAT_SYNC':
            msgs = cmd.get('messages', [])
            txt.config(state='normal')
            txt.delete('1.0', 'end')
            txt.config(state='disabled')
            add_msg('Sistem', 'Destek oturumu baslatildi. Teknisyene dogrudan buradan cevap yazabilirsiniz.', time.strftime('%H:%M:%S'), 'sys_hdr')
            for m in msgs:
                snd = m.get('sender', '')
                tag = 'tech_hdr' if ('Technician' in snd or 'Teknisyen' in snd) else ('sys_hdr' if ('System' in snd or 'Sistem' in snd) else 'user_hdr')
                add_msg(snd, m.get('text', ''), m.get('time', ''), tag)
        elif t == 'SHOW_WINDOW':
            root.deiconify()
            root.lift()
            root.attributes('-topmost', True)
            root.after(400, lambda: root.attributes('-topmost', False))
            entry.focus_set()

    def socket_receiver():
        nonlocal sock
        buf = ''
        while True:
            try:
                if not sock:
                    time.sleep(1)
                    try:
                        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                        s.connect(('127.0.0.1', CHAT_IPC_PORT))
                        sock = s
                    except: continue
                data = sock.recv(4096)
                if not data:
                    sock.close()
                    sock = None
                    time.sleep(1)
                    continue
                buf += data.decode('utf-8', errors='ignore')
                lines = buf.split('\n'); buf = lines.pop()
                for line in lines:
                    line = line.strip()
                    if not line: continue
                    try:
                        cmd = json.loads(line)
                        root.after(0, lambda c=cmd: handle_incoming(c))
                    except: pass
            except:
                if sock:
                    try: sock.close()
                    except: pass
                    sock = None
                time.sleep(1)

    threading.Thread(target=socket_receiver, daemon=True).start()

    root.protocol('WM_DELETE_WINDOW', root.withdraw)
    root.mainloop()

AGENT_VERSION = 'RemoteMM v4.2'

def do_agent_upgrade(conn, cmd):
    url = cmd.get('url', '')
    if not url: return
    try:
        import urllib.request
        send_json_safe(conn, {'type': 'UPGRADE_PROGRESS', 'message': 'Yeni agent sürümü indiriliyor...'})
        target_dir = os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else r'C:\RemoteMM'
        os.makedirs(target_dir, exist_ok=True)
        new_exe = os.path.join(target_dir, 'RemoteMM_Agent_new.exe')
        curr_exe = sys.executable if getattr(sys, 'frozen', False) else os.path.join(target_dir, 'RemoteMM_Agent.exe')
        
        # Download new binary
        urllib.request.urlretrieve(url, new_exe)
        send_json_safe(conn, {'type': 'UPGRADE_PROGRESS', 'message': 'Yeni sürüm indirildi, yeniden başlatılıyor...'})
        
        # Batch updater script that waits 2 seconds, kills current process, overwrites, starts service or exe
        bat_file = os.path.join(target_dir, 'agent_update.bat')
        with open(bat_file, 'w', encoding='utf-8') as f:
            f.write(f'''@echo off
timeout /t 2 /nobreak >nul
taskkill /F /IM RemoteMM_Agent.exe >nul 2>&1
move /Y "{new_exe}" "{curr_exe}" >nul 2>&1
sc.exe start RemoteMMAgent >nul 2>&1
if errorlevel 1 (
    start "" "{curr_exe}"
)
del "%~f0"
''')
        subprocess.Popen(['cmd.exe', '/c', bat_file], creationflags=0x08000000)
        time.sleep(0.5)
        os._exit(0)
    except Exception as e:
        send_json_safe(conn, {'type': 'UPGRADE_ERROR', 'message': str(e)})

def handle_client(conn, addr):
    global LOCKED, BLACKOUT
    with CLIENTS_LOCK:
        ACTIVE_CLIENTS.append(conn)

    hostname = socket.gethostname()
    try: uname = os.getlogin()
    except: uname = 'User'
    try:
        import uuid
        mac_num = uuid.getnode()
        mac_str = ':'.join(f'{(mac_num >> (8 * i)) & 0xff:02x}' for i in reversed(range(6)))
    except:
        mac_str = ''
    w, h = get_scr()
    ident = load_or_create_identity()
    hs = {
        'type': 'HANDSHAKE_ACK',
        'agentVersion': AGENT_VERSION,
        'hostname': hostname,
        'user': uname,
        'macAddress': mac_str,
        'screenWidth': w,
        'screenHeight': h,
        'os': 'Windows',
        'hwid': ident.get('hwid', ''),
        'tenantId': ident.get('tenantId', 'tenant_default'),
        'deviceToken': ident.get('deviceToken', '')
    }
    if not send_json_safe(conn, hs):
        with CLIENTS_LOCK:
            if conn in ACTIVE_CLIENTS: ACTIVE_CLIENTS.remove(conn)
        conn.close()
        return

    # Send current chat history immediately to connecting technician
    send_json_safe(conn, {'type': 'CHAT_BROADCAST', 'messages': list(CHAT_HISTORY)})

    quality = [88]
    fps = [0.016]
    stream_mode = ['INTERACTIVE']
    last_telemetry_time = [0.0]
    client_alive = [True]

    def stream():
        switch_desktop()
        while client_alive[0]:
            try:
                now = time.time()
                # 5 saniyede bir hafif telemetri guncellemesi yayinla
                if now - last_telemetry_time[0] >= 5.0:
                    last_telemetry_time[0] = now
                    try:
                        telem = collect_full_telemetry()
                        send_json_safe(conn, {'type': 'TELEMETRY_UPDATE', 'data': telem})
                    except Exception:
                        pass

                # NOC Preview (dusuk ag ve CPU modu) vs Canli Interaktif Stream
                if stream_mode[0] == 'PREVIEW':
                    thumb = capture_thumbnail()
                    if thumb:
                        send_json_safe(conn, {
                            'type': 'NOC_THUMBNAIL',
                            'frame': thumb,
                            'timestamp': int(now * 1000)
                        })
                    time.sleep(2.0)
                    continue

                t0 = time.time()
                frame = capture_gdi(quality[0])
                if frame:
                    w2, h2 = get_scr()
                    send_json_safe(conn, {
                        'type': 'SCREEN_FRAME',
                        'frame': frame,
                        'timestamp': int(t0 * 1000),
                        'width': w2,
                        'height': h2,
                        'blackedOut': BLACKOUT
                    })
                elapsed = time.time() - t0
                target_delay = fps[0] if fps[0] > 0 else 0.016
                time.sleep(max(0.001, target_delay - elapsed))
            except Exception:
                time.sleep(0.05)

    threading.Thread(target=stream, daemon=True).start()
    buf = ''
    while client_alive[0]:
        try:
            data = conn.recv(16384)
            if not data: break

            buf += data.decode('utf-8', errors='ignore')
            lines = buf.split('\n'); buf = lines.pop()
            for line in lines:
                line = line.strip()
                if not line: continue
                try: cmd = json.loads(line)
                except: continue
                t = cmd.get('type','')
                if   t=='MOUSE_INPUT':    do_mouse(cmd)
                elif t=='KEYBOARD_INPUT': do_key(cmd)
                elif t=='LOCK_INPUT':
                    LOCKED = bool(cmd.get('locked',False))
                elif t=='BLACKOUT_SCREEN':
                    BLACKOUT = bool(cmd.get('blackout',False))
                elif t=='CHAT_MESSAGE':
                    text = cmd.get('text', '').strip()
                    if text:
                        t_str = time.strftime('%H:%M:%S')
                        msg_obj = {
                            'sender': 'Technician',
                            'text': text,
                            'time': t_str
                        }
                        CHAT_HISTORY.append(msg_obj)
                        broadcast_chat()
                        ensure_chat_ui()
                        broadcast_to_chat_ui({
                            'type': 'CHAT_INCOMING',
                            'sender': 'Teknisyen',
                            'text': text,
                            'time': t_str
                        })
                elif t=='CHAT_OPEN':
                    ensure_chat_ui()
                elif t=='SET_STREAM_MODE':
                    stream_mode[0] = str(cmd.get('mode', 'INTERACTIVE')).upper()
                elif t=='GET_THUMBNAIL':
                    th = capture_thumbnail()
                    send_json_safe(conn, {'type': 'THUMBNAIL_RESPONSE', 'frame': th})
                elif t=='TELEMETRY_REQUEST':
                    send_json_safe(conn, {'type': 'TELEMETRY_RESPONSE', 'data': collect_full_telemetry()})
                elif t=='SET_QUALITY': quality[0] = max(30,min(95,int(cmd.get('quality',88))))
                elif t=='SET_FPS':
                    req_fps = int(cmd.get('fps',0))
                    fps[0] = 0.016 if (req_fps <= 0 or req_fps >= 60) else (1.0 / max(5, req_fps))

                elif t=='AUDIO_CHUNK':
                    try:
                        raw_b64 = cmd.get('data', '')
                        if raw_b64:
                            ab = base64.b64decode(raw_b64)
                            if not AUDIO_QUEUE.full():
                                AUDIO_QUEUE.put(ab)
                    except: pass
                elif t=='AUDIO_BEEP':
                    try:
                        winsound.MessageBeep(0x00000040)
                    except: pass
                elif t=='PING':
                    send_json_safe(conn, {'type':'PONG','timestamp':int(time.time()*1000)})
                elif t=='POWER_ACTION':
                    enable_shutdown_privilege()
                    a = cmd.get('action','')
                    if   a=='reboot':    os.system('shutdown /r /f /t 1')
                    elif a=='shutdown':  os.system('shutdown /s /f /t 1')
                    elif a=='sleep':     os.system('rundll32.exe powrprof.dll,SetSuspendState 0,1,0')
                    elif a=='hibernate': os.system('shutdown /h')
                    elif a=='lock':      os.system('rundll32.exe user32.dll,LockWorkStation')
                    elif a=='logoff':    os.system('logoff')
                    elif a=='abort':     os.system('shutdown /a')
                elif t.startswith('FS_'):
                    threading.Thread(target=handle_fs, args=(conn, cmd), daemon=True).start()
                elif t=='TASK_LIST':
                    threading.Thread(target=handle_task_list, args=(conn,), daemon=True).start()
                elif t=='KILL_PROCESS':
                    try: os.system(f'taskkill /F /PID {int(cmd.get("pid",0))}')
                    except: pass
                elif t=='AGENT_UPGRADE':
                    threading.Thread(target=do_agent_upgrade, args=(conn, cmd), daemon=True).start()
        except: break
    client_alive[0] = False
    with CLIENTS_LOCK:
        if conn in ACTIVE_CLIENTS: ACTIVE_CLIENTS.remove(conn)
    LOCKED = False
    BLACKOUT = False
    conn.close()

def enable_shutdown_privilege():
    try:
        advapi32 = ctypes.windll.advapi32
        SE_SHUTDOWN_NAME = "SeShutdownPrivilege"
        SE_PRIVILEGE_ENABLED = 0x00000002
        TOKEN_ADJUST_PRIVILEGES = 0x0020
        TOKEN_QUERY = 0x0008

        hToken = ctypes.c_void_p()
        if advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, ctypes.byref(hToken)):
            class LUID(ctypes.Structure):
                _fields_ = [('LowPart', ctypes.c_ulong), ('HighPart', ctypes.c_long)]
            class LUID_AND_ATTRIBUTES(ctypes.Structure):
                _fields_ = [('Luid', LUID), ('Attributes', ctypes.c_ulong)]
            class TOKEN_PRIVILEGES(ctypes.Structure):
                _fields_ = [('PrivilegeCount', ctypes.c_ulong), ('Privileges', LUID_AND_ATTRIBUTES * 1)]

            luid = LUID()
            if advapi32.LookupPrivilegeValueW(None, SE_SHUTDOWN_NAME, ctypes.byref(luid)):
                tp = TOKEN_PRIVILEGES()
                tp.PrivilegeCount = 1
                tp.Privileges[0].Luid = luid
                tp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED
                advapi32.AdjustTokenPrivileges(hToken, False, ctypes.byref(tp), 0, None, None)
            kernel32.CloseHandle(hToken)
    except:
        pass

def configure_system_for_wol_and_power():
    """
    Her PC ve Windows Server'da Wake-on-LAN ve Guc Yonetiminin
    kesin ve hatasiz calismasini saglamak icin Windows ayarlarini optimize eder:
    1. Windows Hizli Baslatma (Hiberboot) kapatilir (NIC S5 durumunda uyanabilsin).
    2. Ag bagdastiricilarinda Magic Packet ile uyandirma (WakeOnMagicPacket) acilir.
    3. Windows Guvenlik Duvari'nda WoL portlari (UDP 7, 9) ve Agent portu (TCP 6129) acilir.
    """
    try:
        # 1. Hiberboot kapatma (Fast Startup kapali olmali, yoksa WoL calismaz)
        os.system('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power" /v HiberbootEnabled /t REG_DWORD /d 0 /f >nul 2>&1')
        
        # 2. Ag Kartlarinda Wake-on-LAN'i PowerShell ile etkinlestir
        ps_wol = (
            "$ErrorActionPreference = 'SilentlyContinue'; "
            "Get-NetAdapter | ForEach-Object { "
            "  Enable-NetAdapterPowerManagement -Name $_.Name -WakeOnMagicPacket; "
            "  Set-NetAdapterPowerManagement -Name $_.Name -WakeOnMagicPacket $true; "
            "  Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName '*Wake on Magic Packet*' -DisplayValue 'Enabled'; "
            "  Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName '*Wake on Pattern*' -DisplayValue 'Enabled'; "
            "  Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName '*Shutdown Wake-Up*' -DisplayValue 'Enabled'; "
            "}"
        )
        cmd_enc = base64.b64encode(ps_wol.encode('utf-16le')).decode('ascii')
        os.system(f'powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand {cmd_enc} >nul 2>&1')
        
        # 3. Guvenlik Duvari Kurallari
        os.system('netsh advfirewall firewall add rule name="RemoteMM_WoL_In" dir=in action=allow protocol=UDP localport=7,9 >nul 2>&1')
        os.system(f'netsh advfirewall firewall add rule name="RemoteMMAgent" dir=in action=allow protocol=TCP localport={PORT} >nul 2>&1')
    except:
        pass

def start_server():
    threading.Thread(target=configure_system_for_wol_and_power, daemon=True).start()
    threading.Thread(target=input_and_curtain_manager, daemon=True).start()
    threading.Thread(target=start_chat_ipc_server, daemon=True).start()
    srv = socket.socket()
    for _ in range(15):
        try:
            srv.bind(('0.0.0.0', PORT))
            break
        except:
            time.sleep(1)
    else: return
    srv.listen(10); srv.settimeout(2.0)
    while True:
        try:
            conn, addr = srv.accept()
            threading.Thread(target=handle_client, args=(conn,addr), daemon=True).start()
        except socket.timeout: continue
        except: break
    srv.close()


def try_run_as_service():
    """Eger Windows Servisi olarak baslatildiysa SCM'ye baglanir ve calisir."""
    try:
        class SERVICE_STATUS(ctypes.Structure):
            _fields_ = [
                ('dwServiceType',             ctypes.c_uint32),
                ('dwCurrentState',            ctypes.c_uint32),
                ('dwControlsAccepted',        ctypes.c_uint32),
                ('dwWin32ExitCode',           ctypes.c_uint32),
                ('dwServiceSpecificExitCode', ctypes.c_uint32),
                ('dwCheckPoint',              ctypes.c_uint32),
                ('dwWaitHint',                ctypes.c_uint32)
            ]

        STATUS_HANDLE = [None]
        def service_handler(control, dwEventType, lpEventData, lpContext):
            if control in (1, 5):
                st = SERVICE_STATUS()
                st.dwServiceType = 0x10
                st.dwCurrentState = 1
                advapi32.SetServiceStatus(STATUS_HANDLE[0], ctypes.byref(st))
            return 0

        HANDLER_PROC = ctypes.WINFUNCTYPE(ctypes.c_uint32, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_void_p)(service_handler)

        def service_main(argc, argv):
            STATUS_HANDLE[0] = advapi32.RegisterServiceCtrlHandlerExW("RemoteMMAgent", HANDLER_PROC, None)
            st = SERVICE_STATUS()
            st.dwServiceType = 0x10
            st.dwCurrentState = 4
            st.dwControlsAccepted = 1 | 5
            advapi32.SetServiceStatus(STATUS_HANDLE[0], ctypes.byref(st))
            watchdog_loop()

        MAIN_PROC = ctypes.WINFUNCTYPE(None, ctypes.c_uint32, ctypes.c_void_p)(service_main)

        class STE(ctypes.Structure):
            _fields_ = [('lpServiceName', ctypes.c_wchar_p), ('lpServiceProc', ctypes.c_void_p)]
        table = (STE * 2)()
        table[0].lpServiceName = 'RemoteMMAgent'
        table[0].lpServiceProc = ctypes.cast(MAIN_PROC, ctypes.c_void_p).value
        table[1].lpServiceName = None
        table[1].lpServiceProc = None

        advapi32.StartServiceCtrlDispatcherW(table)
    except: pass

# ─── ENTRY POINT ─────────────────────────────────────────────
if __name__ == '__main__':
    try:
        if '--chat-ui' in sys.argv:
            run_chat_ui()
            sys.exit(0)
        elif '--server' in sys.argv:
            start_server()
        else:
            enable_all_privileges()
            try_run_as_service()
            curr_sess = ctypes.c_ulong()
            kernel32.ProcessIdToSessionId(kernel32.GetCurrentProcessId(), ctypes.byref(curr_sess))
            if curr_sess.value > 0:
                start_server()
            else:
                watchdog_loop()
    except Exception as e:
        import traceback
        log_file = os.path.join(os.path.dirname(AGENT_PATH), "agent_crash.log")
        with open(log_file, "a") as f: f.write(f"Crash: {e}\n{traceback.format_exc()}\n")
