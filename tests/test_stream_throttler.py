import os
import sys
import unittest

sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'agent'))
import stream_throttler

class TestStreamThrottler(unittest.TestCase):
    def test_adaptive_stream_latency_tiers(self):
        """Bölüm 4.1: Ağ gecikmesine göre kalite ve FPS seviyelerini test eder."""
        ctrl = stream_throttler.AdaptiveStreamController(is_adaptive=True)

        # 1. Düşük gecikme (20ms) -> ULTRA_60FPS
        quality, delay, tier = ctrl.record_rtt(20.0)
        self.assertEqual(tier, 'ULTRA_60FPS')
        self.assertEqual(quality, 92)
        self.assertAlmostEqual(delay, 0.016, places=3)

        # 2. Orta gecikme (100ms) -> Hızlı geçiş BALANCED_30FPS
        for _ in range(5):
            quality, delay, tier = ctrl.record_rtt(100.0)
        self.assertEqual(tier, 'BALANCED_30FPS')
        self.assertEqual(quality, 78)

        # 3. Yüksek gecikme ani sıçrama (250ms) -> Anında CONSERVE_18FPS
        for _ in range(5):
            quality, delay, tier = ctrl.record_rtt(250.0)
        self.assertEqual(tier, 'CONSERVE_18FPS')
        self.assertEqual(quality, 58)

        # 4. Kritik gecikme (> 350ms) -> LOW_BANDWIDTH_8FPS
        for _ in range(5):
            quality, delay, tier = ctrl.record_rtt(400.0)
        self.assertEqual(tier, 'LOW_BANDWIDTH_8FPS')
        self.assertEqual(quality, 40)

    def test_backpressure_drop_penalty(self):
        """Geri basınç durumunda kare düşürme cezasını test eder."""
        ctrl = stream_throttler.AdaptiveStreamController(is_adaptive=True)
        # Başlangıç Ultra
        ctrl.record_rtt(20.0)
        self.assertEqual(ctrl.current_tier_idx, 0)

        # Gateway drop bildirdiğinde derhal alt kademeye inmeli
        quality, delay, tier = ctrl.record_backpressure_drop(1)
        self.assertEqual(ctrl.current_tier_idx, 1)
        self.assertEqual(tier, 'BALANCED_30FPS')

    def test_hysteresis_cautious_upshift(self):
        """Ağ toparlandığında dalgalanmayı önlemek için EMA filtreleme ve 3 ardışık iyi örnek kuralını test eder."""
        ctrl = stream_throttler.AdaptiveStreamController(is_adaptive=True)
        # Orta gecikmeye ayarla
        for _ in range(5):
            ctrl.record_rtt(120.0)
        self.assertEqual(ctrl.current_tier_idx, 1)

        # İlk birkaç örnekte smoothed_rtt kademeli düşerken henüz Ultra'ya zıplamamalı
        ctrl.record_rtt(20.0)
        self.assertEqual(ctrl.current_tier_idx, 1)
        ctrl.record_rtt(20.0)
        self.assertEqual(ctrl.current_tier_idx, 1)
        ctrl.record_rtt(20.0)
        self.assertEqual(ctrl.current_tier_idx, 1)
        ctrl.record_rtt(20.0)
        self.assertEqual(ctrl.current_tier_idx, 1)

        # 5. ardışık iyi örnekte smoothed_rtt < 60ms olur ve 3. iyi örnek sayacı dolarak Ultra'ya geçer
        ctrl.record_rtt(20.0)
        self.assertEqual(ctrl.current_tier_idx, 0)
        self.assertEqual(ctrl.get_current_params()['tierName'], 'ULTRA_60FPS')

if __name__ == '__main__':
    unittest.main()
