"""
RemoteMM Enterprise — Güvenli Ajan Güncelleme ve Otomatik Geri Alma Motoru
(agent/updater.py)

ISO 27001 ve Şartname Bölüm 7.2 gereksinimlerine uygun Auto-Rollback Durum Makinesi:
1. İndirilen binary'nin SHA-256 hash doğrulaması (Bozuk/tahrif edilmiş dosyayı derhal imha etme)
2. Mevcut binary'yi otomatik yedekleme (RemoteMM_Agent.bak)
3. Dosya değiştirme ve servis yeniden başlatma
4. 30 saniye içinde sağlık sinyali (Heartbeat) kontrolü
5. Hata veya çökme durumunda otomatik eski sürüme geri dönme (Rollback) ve sunucuya bildirim
"""

import os
import sys
import shutil
import hashlib
import time
import subprocess
import urllib.request
import urllib.error
from typing import Optional, Tuple, Dict, Any

MAX_UPGRADE_FILE_SIZE = 50 * 1024 * 1024  # 50 MB limit for safety


class AutoUpdater:
    def __init__(self, current_binary_path: Optional[str] = None):
        if not current_binary_path:
            self.current_binary = os.path.abspath(sys.executable if getattr(sys, 'frozen', False) else __file__)
        else:
            self.current_binary = os.path.abspath(current_binary_path)

        self.base_dir = os.path.dirname(self.current_binary)
        self.backup_binary = os.path.join(self.base_dir, "RemoteMM_Agent.bak")
        self.temp_binary = os.path.join(self.base_dir, "RemoteMM_Agent_new.exe")
        self.downloaded_binary = os.path.join(self.base_dir, "RemoteMM_Agent_dl.tmp")

    @staticmethod
    def calculate_sha256(file_path: str) -> Optional[str]:
        """Dosyanın SHA-256 özetini hesaplar."""
        if not os.path.isfile(file_path):
            return None
        sha = hashlib.sha256()
        with open(file_path, 'rb') as f:
            while chunk := f.read(65536):
                sha.update(chunk)
        return sha.hexdigest().lower()

    def verify_hash(self, file_path: str, expected_hash: str) -> bool:
        """Dosyanın hash değerini beklenen özet ile doğrular."""
        if not expected_hash:
            return False
        computed = self.calculate_sha256(file_path)
        return computed == expected_hash.lower().strip()

    def download_from_url(self, url: str, target_path: Optional[str] = None, timeout_sec: int = 30) -> Tuple[bool, str]:
        """
        URL üzerinden yeni ajan ikili dosyasını güvenli parçalar halinde indirir.
        Maksimum boyut sınırını kontrol eder.
        """
        dest = target_path or self.downloaded_binary
        try:
            req = urllib.request.Request(
                url,
                headers={'User-Agent': 'RemoteMM-Enterprise-Updater/4.2.0'}
            )
            downloaded = 0
            with urllib.request.urlopen(req, timeout=timeout_sec) as response:
                with open(dest, 'wb') as out_file:
                    while True:
                        chunk = response.read(65536)
                        if not chunk:
                            break
                        downloaded += len(chunk)
                        if downloaded > MAX_UPGRADE_FILE_SIZE:
                            out_file.close()
                            if os.path.exists(dest):
                                os.remove(dest)
                            return False, "EXCEEDS_MAX_FILE_SIZE_50MB"
                        out_file.write(chunk)
            return True, dest
        except Exception as e:
            if os.path.exists(dest):
                try:
                    os.remove(dest)
                except Exception:
                    pass
            return False, f"DOWNLOAD_FAILED_{e}"

    def stage_update(self, source_new_file: str, expected_sha256: str) -> Tuple[bool, str]:
        """
        Yeni binary'yi doğrular ve geçici dizine hazırlar.
        Hash tutmazsa dosyayı derhal siler ve reddeder.
        """
        if not os.path.isfile(source_new_file):
            return False, "SOURCE_FILE_NOT_FOUND"

        if not self.verify_hash(source_new_file, expected_sha256):
            # Tahrif edilmiş veya bozuk dosya: derhal imha et
            try:
                os.remove(source_new_file)
            except Exception:
                pass
            return False, "HASH_VERIFICATION_FAILED"

        # Geçici konuma kopyala
        try:
            shutil.copy2(source_new_file, self.temp_binary)
            return True, "STAGED_SUCCESSFULLY"
        except Exception as e:
            return False, f"STAGE_ERROR_{e}"

    def apply_update_with_backup(self) -> Tuple[bool, str]:
        """
        Mevcut binary'yi .bak olarak yedekler ve yeni binary'yi yerine koyar.
        """
        if not os.path.isfile(self.temp_binary):
            return False, "NO_STAGED_BINARY"

        try:
            # 1. Mevcut binary'yi yedekle
            if os.path.isfile(self.current_binary):
                shutil.copy2(self.current_binary, self.backup_binary)

            # 2. Yeni binary'yi taşı
            shutil.move(self.temp_binary, self.current_binary)
            return True, "APPLIED_PENDING_HEALTHCHECK"
        except Exception as e:
            # Hata durumunda yedeği geri al
            self.rollback()
            return False, f"APPLY_FAILED_{e}"

    def rollback(self) -> Tuple[bool, str]:
        """
        Başarısız güncellemede yedekteki .bak dosyasını geri yükler.
        """
        try:
            if os.path.isfile(self.backup_binary):
                if os.path.isfile(self.current_binary):
                    try:
                        os.remove(self.current_binary)
                    except Exception:
                        pass
                shutil.copy2(self.backup_binary, self.current_binary)
                return True, "ROLLBACK_SUCCESSFUL"
            return False, "NO_BACKUP_FOUND"
        except Exception as e:
            return False, f"ROLLBACK_ERROR_{e}"

    def complete_update_verification(self, is_healthy: bool) -> Tuple[bool, str]:
        """
        30 saniye içindeki sağlık denetimine göre güncellemeyi kalıcılaştırır veya geri alır.
        """
        if is_healthy:
            # Başarılı: Eski yedeği temizle
            try:
                if os.path.isfile(self.backup_binary):
                    os.remove(self.backup_binary)
            except Exception:
                pass
            return True, "UPDATE_COMMITTED"
        else:
            # Başarısız: Eski sürüme geri dön
            rolled_back, msg = self.rollback()
            return False, f"HEALTH_FAILED_{msg}"

    def execute_upgrade_workflow(self, url: str, expected_sha256: str, target_version: Optional[str] = None, dry_run: bool = False) -> Dict[str, Any]:
        """
        Tek adımda indirme, hash doğrulama, yedekleme ve güncelleme akışını yürütür.
        """
        # 1. İndir
        dl_ok, dl_res = self.download_from_url(url)
        if not dl_ok:
            return {
                'success': False,
                'stage': 'DOWNLOAD',
                'error': dl_res
            }

        # 2. Doğrula ve Sahnele
        stage_ok, stage_msg = self.stage_update(dl_res, expected_sha256)
        # İndirilen tmp dosyasını temizle
        if os.path.isfile(dl_res) and dl_res != self.temp_binary:
            try:
                os.remove(dl_res)
            except Exception:
                pass

        if not stage_ok:
            return {
                'success': False,
                'stage': 'VERIFICATION',
                'error': stage_msg
            }

        # Dry run ise dosyayı değiştirmeden başarılı dön
        if dry_run:
            if os.path.isfile(self.temp_binary):
                try:
                    os.remove(self.temp_binary)
                except Exception:
                    pass
            return {
                'success': True,
                'stage': 'DRY_RUN',
                'targetVersion': target_version,
                'expectedSha256': expected_sha256,
                'message': 'VERIFIED_AND_STAGED_OK'
            }

        # 3. Yedeği al ve yeni dosyayı yerleştir
        apply_ok, apply_msg = self.apply_update_with_backup()
        if not apply_ok:
            return {
                'success': False,
                'stage': 'APPLY',
                'error': apply_msg
            }

        return {
            'success': True,
            'stage': 'APPLIED',
            'targetVersion': target_version,
            'expectedSha256': expected_sha256,
            'status': apply_msg,
            'backupFile': self.backup_binary
        }
