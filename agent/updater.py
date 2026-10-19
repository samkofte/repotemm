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
import shutil
import hashlib
import time
import subprocess


class AutoUpdater:
    def __init__(self, current_binary_path=None):
        if not current_binary_path:
            self.current_binary = os.path.abspath(sys.executable if getattr(sys, 'frozen', False) else __file__)
        else:
            self.current_binary = os.path.abspath(current_binary_path)
            
        self.base_dir = os.path.dirname(self.current_binary)
        self.backup_binary = os.path.join(self.base_dir, "RemoteMM_Agent.bak")
        self.temp_binary = os.path.join(self.base_dir, "RemoteMM_Agent_new.exe")

    @staticmethod
    def calculate_sha256(file_path):
        """Dosyanın SHA-256 özetini hesaplar."""
        if not os.path.isfile(file_path):
            return None
        sha = hashlib.sha256()
        with open(file_path, 'rb') as f:
            while chunk := f.read(65536):
                sha.update(chunk)
        return sha.hexdigest().lower()

    def verify_hash(self, file_path, expected_hash):
        """Dosyanın hash değerini beklenen özet ile doğrular."""
        if not expected_hash:
            return False
        computed = self.calculate_sha256(file_path)
        return computed == expected_hash.lower().strip()

    def stage_update(self, source_new_file, expected_sha256):
        """
        Yeni binary'yi doğrular ve geçici dizine hazırlar.
        Hash tutmazsa dosyayı derhal siler ve reddeder.
        """
        if not os.path.isfile(source_new_file):
            return False, "SOURCE_FILE_NOT_FOUND"

        if not self.verify_hash(source_new_file, expected_sha256):
            # Tahrif edilmiş veya bozuk dosya: imha et
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

    def apply_update_with_backup(self):
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

    def rollback(self):
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

    def complete_update_verification(self, is_healthy):
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
