import os
import sys
import hashlib
import tempfile
import unittest

sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'agent'))
import file_manager

class TestFileManager(unittest.TestCase):
    def test_path_traversal_blocking(self):
        """Bölüm 6.2: SAM, SYSTEM ve drivers/etc gibi hassas köklerin engellenmesini test eder."""
        self.assertFalse(file_manager.is_safe_path(r"C:\Windows\System32\config\SAM"))
        self.assertFalse(file_manager.is_safe_path(r"C:\Windows\System32\config\SYSTEM"))
        self.assertFalse(file_manager.is_safe_path(r"C:\Windows\System32\drivers\etc\hosts"))
        self.assertFalse(file_manager.is_safe_path(r"C:\test\..\Windows\System32\config\SAM"))
        self.assertFalse(file_manager.is_safe_path(r"C:\Windows\System32\drivers\etc\networks"))
        self.assertFalse(file_manager.is_safe_path(r"C:\safe\file.txt:hidden_stream"))

        # Geçerli yollar izinli olmalı
        self.assertTrue(file_manager.is_safe_path(r"C:\RemoteMM\agent.log"))
        self.assertTrue(file_manager.is_safe_path(r"C:\Users\Public\Downloads\setup.exe"))
        self.assertTrue(file_manager.is_safe_path(r"D:\Backups\2026\database.bak"))

    def test_256kb_chunked_upload_and_sha256_verification(self):
        """Bölüm 3.2 & 6.2: 256 KB parçalı yükleme ve SHA-256 bütünlük onayını test eder."""
        mgr = file_manager.ChunkedUploadManager()

        # 600 KB test verisi üret (3 parça: 256KB + 256KB + 88KB)
        raw_data = os.urandom(600 * 1024)
        expected_sha = hashlib.sha256(raw_data).hexdigest()

        with tempfile.TemporaryDirectory() as tmp_dir:
            target_path = os.path.join(tmp_dir, "uploaded_test_file.bin")
            upload_id = "upl_test_123"

            chunk_size = file_manager.CHUNK_SIZE
            total_chunks = (len(raw_data) + chunk_size - 1) // chunk_size

            # 1. Start upload
            ok, msg = mgr.start_upload(upload_id, target_path, total_chunks, len(raw_data), expected_sha)
            self.assertTrue(ok)
            self.assertEqual(msg, "READY")

            # 2. Write chunks
            for i in range(total_chunks):
                start = i * chunk_size
                chunk_bytes = raw_data[start:start + chunk_size]
                c_ok, c_msg, meta = mgr.write_chunk(upload_id, i, chunk_bytes)
                self.assertTrue(c_ok)
                self.assertEqual(meta['chunkIndex'], i)
                self.assertEqual(meta['totalChunks'], total_chunks)

            # 3. Finalize upload
            f_ok, f_msg, result = mgr.finalize_upload(upload_id)
            self.assertTrue(f_ok)
            self.assertEqual(f_msg, "SUCCESS")
            self.assertEqual(result['sha256'], expected_sha)
            self.assertEqual(result['size'], len(raw_data))

            # Diskteki dosyanın içeriğini doğrula
            self.assertTrue(os.path.exists(target_path))
            with open(target_path, 'rb') as f:
                saved = f.read()
            self.assertEqual(saved, raw_data)

    def test_tamper_detection_immediate_deletion(self):
        """Bölüm 6.2: SHA-256 uyuşmazlığında dosyanın anında silinmesini (tamper protection) test eder."""
        mgr = file_manager.ChunkedUploadManager()

        raw_data = b"RemoteMM Enterprise Genuine Payload" * 1000
        # Yanlış / tahrif edilmiş sha256 bildir
        fake_sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

        with tempfile.TemporaryDirectory() as tmp_dir:
            target_path = os.path.join(tmp_dir, "tampered_file.bin")
            upload_id = "upl_tamper_test"

            ok, _ = mgr.start_upload(upload_id, target_path, 1, len(raw_data), fake_sha)
            self.assertTrue(ok)

            mgr.write_chunk(upload_id, 0, raw_data)

            # Finalize uyuşmazlık nedeniyle reddedilmeli
            f_ok, f_msg, _ = mgr.finalize_upload(upload_id)
            self.assertFalse(f_ok)
            self.assertEqual(f_msg, "TAMPER_DETECTED_SHA256_MISMATCH")

            # Ne hedef dosya ne de .part dosyası diskte kalmamalı
            self.assertFalse(os.path.exists(target_path))
            dir_files = os.listdir(tmp_dir)
            self.assertEqual(len(dir_files), 0, "Tahrif edilen parçalı dosya derhal imha edilmelidir.")

    def test_chunked_download_streaming(self):
        """Bölüm 3.2: 256 KB dilimli dosya indirme hazırlığı ve okumasını test eder."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            src_file = os.path.join(tmp_dir, "source_to_download.dat")
            test_content = os.urandom(550 * 1024)  # 550 KB
            with open(src_file, 'wb') as f:
                f.write(test_content)
            expected_sha = hashlib.sha256(test_content).hexdigest()

            # Metadata hazırlığı
            ok, msg, meta = file_manager.get_file_metadata_for_download(src_file)
            self.assertTrue(ok)
            self.assertEqual(meta['totalSize'], len(test_content))
            self.assertEqual(meta['sha256'], expected_sha)
            self.assertEqual(meta['totalChunks'], 3)

            # Parçaları sırayla oku ve birleştir
            reassembled = bytearray()
            for i in range(meta['totalChunks']):
                r_ok, chunk_bytes, _ = file_manager.read_file_chunk(src_file, i)
                self.assertTrue(r_ok)
                reassembled.extend(chunk_bytes)

            self.assertEqual(bytes(reassembled), test_content)

if __name__ == '__main__':
    unittest.main()
