"""
RemoteMM Enterprise - Virtual Enterprise Workstation Simulator
(agent/workstation_simulator.py)
---------------------------------------------------------------
Simulates a corporate Windows workstation node for Docker multi-machine
fleet testing, push deployment, live RMM2 screen streaming, and telemetries.
"""

import os
import sys
import time
import json
import socket
import select
import random
import threading
import argparse
import base64
import hashlib
import urllib.request
import urllib.error
from io import BytesIO

try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


def create_synthetic_frame(hostname: str, ip: str, os_name: str, cpu_pct: float, ram_pct: float, frame_idx: int) -> bytes:
    """Generates a realistic 1280x720 simulated Windows 11 desktop frame as JPEG."""
    width, height = 1280, 720
    if not HAS_PIL:
        # Fallback minimal JPEG header
        return b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00\xff\xdb\x00C\x00\xff\xd9'

    # Dark fluent wallpaper background
    img = Image.new('RGB', (width, height), color=(15, 23, 42))
    draw = ImageDraw.Draw(img)

    # Ambient radial gradient effect in center
    draw.ellipse([width // 4, height // 4, 3 * width // 4, 3 * height // 4], fill=(30, 41, 59))
    draw.ellipse([width // 3, height // 3, 2 * width // 3, 2 * height // 3], fill=(51, 65, 85))

    # Desktop Icons on the left
    desktop_icons = [
        ("💻", "Bu Bilgisayar"),
        ("📁", "Departman Belgeleri"),
        ("🌐", "Kurumsal Intranet"),
        ("📊", "ERP & Finans Portali"),
        ("🗑️", "Geri Donusum")
    ]
    for i, (ico, label) in enumerate(desktop_icons):
        iy = 40 + (i * 85)
        draw.rectangle([35, iy, 95, iy + 50], fill=(30, 41, 59, 120), outline=(51, 65, 85))
        draw.text((55, iy + 14), ico, fill=(241, 245, 249))
        draw.text((25, iy + 55), label[:16], fill=(226, 232, 240))

    # Windows 11 Taskbar at the bottom (Height: 48px)
    taskbar_y = height - 48
    draw.rectangle([0, taskbar_y, width, height], fill=(15, 23, 42))
    draw.line([0, taskbar_y, width, taskbar_y], fill=(51, 65, 85), width=1)

    # Windows Start Logo and Taskbar App Icons (Centered)
    tb_center = width // 2
    icons = ["🪟", "🔍", "📁", "🌐", "💻", "⚙️"]
    for i, icon in enumerate(icons):
        x = tb_center - 120 + (i * 40)
        draw.rectangle([x, taskbar_y + 8, x + 32, taskbar_y + 40], fill=(30, 41, 59), outline=(71, 85, 105))
        draw.text((x + 8, taskbar_y + 12), icon, fill=(241, 245, 249))

    # System Tray Clock (Bottom Right)
    now_str = time.strftime("%H:%M:%S  |  %d.%m.%Y")
    draw.text((width - 180, taskbar_y + 16), now_str, fill=(148, 163, 184))

    # Simulated Live Terminal Window (Centered)
    win_x1, win_y1 = 200, 60
    win_x2, win_y2 = 1080, 580
    # Window Header
    draw.rectangle([win_x1, win_y1, win_x2, win_y1 + 36], fill=(30, 41, 59))
    draw.text((win_x1 + 18, win_y1 + 10), f"PowerShell 7.4.5 - Administrator: {hostname} ({ip}) - {os_name}", fill=(241, 245, 249))
    # Window Window Controls (Minimize, Maximize, Close)
    draw.text((win_x2 - 70, win_y1 + 10), "—  □  ✕", fill=(148, 163, 184))

    # Window Body
    draw.rectangle([win_x1, win_y1 + 36, win_x2, win_y2], fill=(2, 6, 23), outline=(51, 65, 85))

    terminal_lines = [
        f"Windows PowerShell - RemoteMM Enterprise Management Engine",
        f"Telif Hakki (C) Microsoft Corporation. Tum haklari saklidir.",
        f"",
        f"PS C:\\Users\\Admin> Get-ComputerInfo | Format-List Hostname, OS, Processor, RAM",
        f"Hostname       : {hostname}",
        f"OS             : {os_name}",
        f"Processor      : Intel/AMD Multi-Core Architecture",
        f"PS C:\\Users\\Admin> Get-Service -Name RemoteMMAgent",
        f"Status   Name               DisplayName",
        f"------   ----               -----------",
        f"Running  RemoteMMAgent      RemoteMM Support Agent (Active Protocol RMM2)",
        f"",
        f"--- CANLI PERFORMANS & AG HUD ---",
        f"CPU Kullanim   : %{cpu_pct:.1f}  [{'█' * int(cpu_pct / 10)}{'░' * (10 - int(cpu_pct / 10))}]",
        f"RAM Kullanim   : %{ram_pct:.1f}  [{'█' * int(ram_pct / 10)}{'░' * (10 - int(ram_pct / 10))}]",
        f"Ag Gecikmesi   : 1.1 ms  |  Aktif Guvenlik: TLS 1.3 / AES-256-GCM  |  Kare: #{frame_idx}"
    ]
    for i, line in enumerate(terminal_lines):
        color = (52, 211, 153) if "Running" in line else ((244, 63, 94) if "CPU" in line and cpu_pct > 70 else (203, 213, 225))
        draw.text((win_x1 + 20, win_y1 + 50 + (i * 22)), line, fill=color)

    # Encode to JPEG
    buf = BytesIO()
    img.save(buf, format='JPEG', quality=65)
    return buf.getvalue()


class WorkstationSimulator:
    def __init__(
        self,
        hostname: str = "WORKSTATION-01",
        ip: str = "127.0.0.1",
        port: int = 6129,
        gateway_url: str = "http://localhost:3001",
        os_name: str = "Windows 11 Enterprise (24H2)",
        cpu_model: str = "Intel Core i7-13700K 16-Core",
        ram_mb: int = 16384
    ):
        self.hostname = hostname
        self.ip = ip
        self.port = port
        self.gateway_url = gateway_url.rstrip('/')
        self.os_name = os_name
        self.cpu_model = cpu_model
        self.ram_mb = ram_mb
        self.hwid = f"hwid_{hostname.lower()}_{hashlib.sha256(hostname.encode('utf-8')).hexdigest()[:12]}"
        self.running = False
        self.frame_counter = 0

    def start_heartbeat_thread(self):
        def heartbeat_loop():
            while self.running:
                cpu = round(random.uniform(12.0, 48.0), 1)
                ram = round(random.uniform(35.0, 65.0), 1)
                payload = {
                    "hwid": self.hwid,
                    "hostname": self.hostname,
                    "primaryIp": self.ip,
                    "osName": self.os_name,
                    "cpuModel": self.cpu_model,
                    "totalRamMb": self.ram_mb,
                    "agentVersion": "RemoteMM Enterprise v5.1-Lab",
                    "telemetry": {
                        "cpuPercent": cpu,
                        "usedRamMb": int(self.ram_mb * (ram / 100)),
                        "freeDiskGb": 320,
                        "activeUser": f"{self.hostname}\\Administrator",
                        "isLocked": False,
                        "uptimeSec": 86400
                    }
                }
                try:
                    req = urllib.request.Request(
                        f"{self.gateway_url}/api/devices/heartbeat",
                        data=json.dumps(payload).encode('utf-8'),
                        headers={"Content-Type": "application/json"},
                        method="POST"
                    )
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        pass
                except Exception:
                    pass
                time.sleep(5)

        t = threading.Thread(target=heartbeat_loop, daemon=True, name=f"HB-{self.hostname}")
        t.start()

    def handle_client(self, client_sock: socket.socket):
        print(f"[{self.hostname}] NOC Gateway connected to agent port {self.port}!")
        client_sock.settimeout(2.0)

        # 1. Send Handshake ACK
        handshake_ack = {
            "type": "HANDSHAKE_ACK",
            "agentVersion": "RemoteMM Enterprise v5.1-Lab",
            "hostname": self.hostname,
            "user": f"{self.hostname}\\Administrator",
            "macAddress": "00:15:5D:AA:BB:CC",
            "screenWidth": 1280,
            "screenHeight": 720,
            "os": self.os_name,
            "hwid": self.hwid,
            "monitors": [{"id": 0, "name": "Primary Virtual Display", "width": 1280, "height": 720}]
        }
        try:
            client_sock.sendall((json.dumps(handshake_ack) + "\n").encode('utf-8'))
        except Exception:
            client_sock.close()
            return

        buffer = ""
        while self.running:
            # Check for incoming commands
            try:
                readable, _, _ = select.select([client_sock], [], [], 0.04)
                if readable:
                    data = client_sock.recv(4096)
                    if not data:
                        break
                    buffer += data.decode('utf-8', errors='ignore')
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if line:
                            self.process_command(client_sock, line)
            except Exception:
                break

            # Send synthetic video frame at ~16-20 FPS
            self.frame_counter += 1
            cpu = random.uniform(15.0, 50.0)
            ram = random.uniform(40.0, 60.0)
            jpeg_bytes = create_synthetic_frame(self.hostname, self.ip, self.os_name, cpu, ram, self.frame_counter)

            # Send line-delimited JSON SCREEN_FRAME with Base64 JPEG
            frame_b64 = base64.b64encode(jpeg_bytes).decode('ascii')
            frame_msg = {
                "type": "SCREEN_FRAME",
                "frame": frame_b64,
                "width": 1280,
                "height": 720,
                "timestamp": int(time.time() * 1000)
            }

            try:
                client_sock.sendall((json.dumps(frame_msg) + "\n").encode('utf-8'))
            except Exception:
                break

            time.sleep(0.06)

        client_sock.close()
        print(f"[{self.hostname}] NOC Gateway disconnected.")

    def process_command(self, sock: socket.socket, line: str):
        try:
            msg = json.loads(line)
            mtype = msg.get("type", "")

            if mtype == "SYS_INFO_REQ":
                resp = {
                    "type": "SYS_INFO",
                    "hwid": self.hwid,
                    "hostname": self.hostname,
                    "os": self.os_name,
                    "cpu": self.cpu_model,
                    "ram": f"{self.ram_mb} MB"
                }
                sock.sendall((json.dumps(resp) + "\n").encode('utf-8'))

            elif mtype == "TASK_LIST":
                tasks = [
                    {"pid": 4, "name": "System", "cpu": 0.5, "memMb": 8},
                    {"pid": 450, "name": "lsass.exe", "cpu": 0.2, "memMb": 32},
                    {"pid": 1120, "name": "explorer.exe", "cpu": 1.2, "memMb": 95},
                    {"pid": 2680, "name": "RemoteMM_Agent.exe", "cpu": 0.8, "memMb": 42},
                    {"pid": 3410, "name": "msedge.exe", "cpu": 3.4, "memMb": 420}
                ]
                resp = {"type": "TASK_LIST", "tasks": tasks}
                sock.sendall((json.dumps(resp) + "\n").encode('utf-8'))

            elif mtype == "TERMINAL_EXEC":
                cmd = msg.get("cmd", "")
                output = f"[{self.hostname} C:\\Users\\Admin]> {cmd}\nKomut RemoteMM Enterprise tarafindan basariyla yurutuldu.\nExitCode: 0\n"
                resp = {"type": "TERMINAL_OUTPUT", "output": output}
                sock.sendall((json.dumps(resp) + "\n").encode('utf-8'))

        except Exception as e:
            pass

    def run(self):
        self.running = True
        self.start_heartbeat_thread()

        server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server_sock.bind(("0.0.0.0", self.port))
        server_sock.listen(5)
        print(f"=== [RemoteMM Enterprise Workstation Lab] ===")
        print(f"  Hostname: {self.hostname}")
        print(f"  HWID:     {self.hwid}")
        print(f"  OS:       {self.os_name}")
        print(f"  Port:     {self.port}")
        print(f"  Gateway:  {self.gateway_url}")
        print(f"Workstation simulator listening on port {self.port}...\n")

        while self.running:
            try:
                client_sock, addr = server_sock.accept()
                t = threading.Thread(target=self.handle_client, args=(client_sock,), daemon=True)
                t.start()
            except KeyboardInterrupt:
                break
            except Exception:
                break
        server_sock.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="RemoteMM Virtual Workstation Simulator")
    parser.add_argument("--hostname", default="WORKSTATION-01", help="Virtual Hostname")
    parser.add_argument("--ip", default="127.0.0.1", help="Reported IP Address")
    parser.add_argument("--port", type=int, default=6129, help="Listening TCP Port")
    parser.add_argument("--gateway", default="http://localhost:3001", help="Gateway URL")
    parser.add_argument("--os", default="Windows 11 Enterprise (24H2)", help="OS Name")
    parser.add_argument("--cpu", default="Intel Core i7-13700K 16-Core", help="CPU Model")
    parser.add_argument("--ram", type=int, default=16384, help="Total RAM in MB")

    args = parser.parse_args()
    sim = WorkstationSimulator(
        hostname=args.hostname,
        ip=args.ip,
        port=args.port,
        gateway_url=args.gateway,
        os_name=args.os,
        cpu_model=args.cpu,
        ram_mb=args.ram
    )
    sim.run()
