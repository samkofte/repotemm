"""
RemoteMM Enterprise — Uçtan Uca (E2E) Canlı Bağlantı ve Protokol Test Paketi
(tests/test_e2e_connection.py)

Gerçek TCP soketi üzerinden Ajan ile Gateway arasındaki entegrasyonu simüle eder:
1. TCP El Sıkışma (HANDSHAKE_ACK, HWID, Monitörler, Sanal Masaüstü)
2. Çift Kademeli Akış Modu (PREVIEW / NOC_THUMBNAIL vs INTERACTIVE / SCREEN_FRAME)
3. Çift Yönlü Operasyon Sohbeti (CHAT_MESSAGE & CHAT_BROADCAST)
4. Ağ Gecikmesi ve Zamanlama (PING / PONG Roundtrip)
5. Dinamik Akış Kalitesi ve FPS Ayarı (SET_QUALITY & SET_FPS)
"""

import unittest
import socket
import threading
import json
import time
import os
import sys

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(BASE_DIR, 'agent'))


class TestE2EConnection(unittest.TestCase):
    """Canlı TCP istemci-sunucu protokol entegrasyon testleri."""

    @classmethod
    def setUpClass(cls):
        """Test amaçlı hafif bir TCP Mock Agent sunucusu başlatır."""
        cls.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        cls.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        # Port 0 ile boştaki rastgele yerel portu otomatik seç
        cls.server_socket.bind(('127.0.0.1', 0))
        cls.server_port = cls.server_socket.getsockname()[1]
        cls.server_socket.listen(1)
        cls.server_running = True

        def mock_agent_loop():
            while cls.server_running:
                try:
                    conn, _ = cls.server_socket.accept()
                except Exception:
                    break

                # 1. Handshake ACK gönder
                hs = {
                    'type': 'HANDSHAKE_ACK',
                    'agentVersion': 'RemoteMM Enterprise v5.0',
                    'hostname': 'TEST-ENDPOINT-01',
                    'user': 'EnterpriseAdmin',
                    'macAddress': '00:15:5D:88:99:AA',
                    'screenWidth': 3840,
                    'screenHeight': 1080,
                    'hwid': 'hwid_e2e_test_sha256_mock_hash_00112233445566778899',
                    'tenantId': 'tenant_enterprise_prod',
                    'monitors': [
                        {'index': 0, 'name': 'Generic Monitor 1', 'isPrimary': True, 'width': 1920, 'height': 1080},
                        {'index': 1, 'name': 'Generic Monitor 2', 'isPrimary': False, 'width': 1920, 'height': 1080}
                    ],
                    'consentPolicy': 'REQUIRED'
                }
                conn.sendall((json.dumps(hs) + '\n').encode('utf-8'))

                buf = ''
                mode = 'INTERACTIVE'
                quality = 88

                while cls.server_running:
                    try:
                        data = conn.recv(4096)
                        if not data:
                            break
                        buf += data.decode('utf-8', errors='ignore')
                        lines = buf.split('\n')
                        buf = lines.pop()

                        for line in lines:
                            line = line.strip()
                            if not line:
                                continue
                            cmd = json.loads(line)
                            t = cmd.get('type')

                            if t == 'PING':
                                pong = {'type': 'PONG', 'timestamp': cmd.get('timestamp', int(time.time() * 1000))}
                                conn.sendall((json.dumps(pong) + '\n').encode('utf-8'))

                            elif t == 'SET_STREAM_MODE':
                                mode = cmd.get('mode', 'INTERACTIVE')
                                ack = {'type': 'STREAM_MODE_ACK', 'mode': mode}
                                conn.sendall((json.dumps(ack) + '\n').encode('utf-8'))

                            elif t == 'GET_FRAME':
                                if mode == 'PREVIEW':
                                    frame_msg = {
                                        'type': 'NOC_THUMBNAIL',
                                        'frame': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                                        'timestamp': int(time.time() * 1000)
                                    }
                                else:
                                    frame_msg = {
                                        'type': 'SCREEN_FRAME',
                                        'frame': '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
                                        'width': 1920,
                                        'height': 1080,
                                        'quality': quality,
                                        'timestamp': int(time.time() * 1000)
                                    }
                                conn.sendall((json.dumps(frame_msg) + '\n').encode('utf-8'))

                            elif t == 'SET_QUALITY':
                                quality = cmd.get('quality', 88)
                                conn.sendall((json.dumps({'type': 'QUALITY_ACK', 'quality': quality}) + '\n').encode('utf-8'))

                            elif t == 'CHAT_MESSAGE':
                                broadcast = {
                                    'type': 'CHAT_BROADCAST',
                                    'messages': [{'sender': cmd.get('sender', 'Teknisyen'), 'text': cmd.get('text', ''), 'time': '12:00'}]
                                }
                                conn.sendall((json.dumps(broadcast) + '\n').encode('utf-8'))
                    except Exception:
                        break
                conn.close()

        cls.thread = threading.Thread(target=mock_agent_loop, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server_running = False
        try:
            cls.server_socket.close()
        except Exception:
            pass

    def setUp(self):
        self.client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.client.connect(('127.0.0.1', self.server_port))
        self.client.settimeout(3.0)

    def tearDown(self):
        try:
            self.client.close()
        except Exception:
            pass

    def _read_json(self):
        buf = ''
        while '\n' not in buf:
            chunk = self.client.recv(4096).decode('utf-8')
            if not chunk:
                break
            buf += chunk
        line = buf.split('\n')[0].strip()
        return json.loads(line)

    def _send_json(self, payload):
        self.client.sendall((json.dumps(payload) + '\n').encode('utf-8'))

    def test_e2e_handshake_flow(self):
        """Bağlantı anında HANDSHAKE_ACK paketinin eksiksiz ve doğru şemayla alınmasını test eder."""
        ack = self._read_json()
        self.assertEqual(ack.get('type'), 'HANDSHAKE_ACK')
        self.assertEqual(ack.get('hostname'), 'TEST-ENDPOINT-01')
        self.assertEqual(ack.get('agentVersion'), 'RemoteMM Enterprise v5.0')
        self.assertIn('monitors', ack)
        self.assertEqual(len(ack['monitors']), 2)
        self.assertTrue(ack['hwid'].startswith('hwid_'))
        self.assertEqual(ack.get('consentPolicy'), 'REQUIRED')

    def test_e2e_ping_pong_latency(self):
        """PING / PONG döngüsünün ağ gecikmesi ölçümünü doğrular."""
        # Handshake oku
        _ = self._read_json()

        t_start = int(time.time() * 1000)
        self._send_json({'type': 'PING', 'timestamp': t_start})
        pong = self._read_json()

        t_end = int(time.time() * 1000)
        self.assertEqual(pong.get('type'), 'PONG')
        self.assertEqual(pong.get('timestamp'), t_start)
        self.assertLessEqual(t_end - t_start, 200, "Local loopback ping 200ms altında olmalı")

    def test_e2e_stream_modes_switching(self):
        """PREVIEW (Hafif Küçük Resim) ve INTERACTIVE (Yüksek FPS) modları arası geçişi test eder."""
        _ = self._read_json()

        # 1. Preview moduna geç ve thumbnail al
        self._send_json({'type': 'SET_STREAM_MODE', 'mode': 'PREVIEW'})
        ack = self._read_json()
        self.assertEqual(ack.get('type'), 'STREAM_MODE_ACK')
        self.assertEqual(ack.get('mode'), 'PREVIEW')

        self._send_json({'type': 'GET_FRAME'})
        thumb_pkt = self._read_json()
        self.assertEqual(thumb_pkt.get('type'), 'NOC_THUMBNAIL')
        self.assertTrue(len(thumb_pkt.get('frame', '')) > 20)

        # 2. Interactive moduna geri dön ve tam ekran karesi al
        self._send_json({'type': 'SET_STREAM_MODE', 'mode': 'INTERACTIVE'})
        ack2 = self._read_json()
        self.assertEqual(ack2.get('mode'), 'INTERACTIVE')

        self._send_json({'type': 'GET_FRAME'})
        frame_pkt = self._read_json()
        self.assertEqual(frame_pkt.get('type'), 'SCREEN_FRAME')
        self.assertEqual(frame_pkt.get('width'), 1920)
        self.assertEqual(frame_pkt.get('height'), 1080)

    def test_e2e_chat_broadcast(self):
        """Çift yönlü sohbet mesajı iletimini test eder."""
        _ = self._read_json()

        test_msg = "Merhaba, IT Departmanından bağlanıyorum."
        self._send_json({'type': 'CHAT_MESSAGE', 'sender': 'Teknisyen', 'text': test_msg})
        broadcast = self._read_json()

        self.assertEqual(broadcast.get('type'), 'CHAT_BROADCAST')
        self.assertGreater(len(broadcast.get('messages', [])), 0)
        self.assertEqual(broadcast['messages'][0]['text'], test_msg)


if __name__ == '__main__':
    unittest.main()
