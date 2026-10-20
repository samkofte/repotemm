"""
RemoteMM Enterprise - Adaptive Stream Quality & Backpressure Controller
------------------------------------------------------------------------
Monitors round-trip time (RTT latency) and adjusts screen capture quality
and target FPS to prevent network congestion and buffer overflows.
Adheres strictly to docs/ENTERPRISE_ENGINEERING_BIBLE.md Section 4.1 &
.agents/skills/websocket-realtime-systems/SKILL.md.
"""

import time
import threading

class AdaptiveStreamController:
    """
    State machine and hysteresis filter that adapts JPEG compression quality
    and target FPS based on measured RTT latency and backpressure events.
    """
    # Quality and FPS tiers: (max_rtt, quality, fps, target_delay_sec, tier_name)
    TIERS = [
        (60,  92, 60, 0.016, 'ULTRA_60FPS'),
        (150, 78, 30, 0.033, 'BALANCED_30FPS'),
        (300, 58, 18, 0.055, 'CONSERVE_18FPS'),
        (99999, 40, 8, 0.125, 'LOW_BANDWIDTH_8FPS')
    ]

    def __init__(self, is_adaptive: bool = True, smoothing_alpha: float = 0.3):
        self._lock = threading.Lock()
        self.is_adaptive = is_adaptive
        self.alpha = smoothing_alpha  # EMA smoothing factor
        self.smoothed_rtt = 25.0      # Initial optimistic RTT (ms)
        self.current_tier_idx = 0     # Start at Ultra
        self.consecutive_low_samples = 0
        self.total_samples = 0
        self.dropped_frames_reported = 0

    def set_adaptive(self, enabled: bool):
        with self._lock:
            self.is_adaptive = bool(enabled)

    def record_rtt(self, rtt_ms: float) -> tuple[int, float, str]:
        """
        Records an RTT sample, updates smoothed RTT, and recalculates optimal quality and FPS.
        Returns: (quality_percent, target_delay_sec, tier_name)
        """
        with self._lock:
            if rtt_ms < 0:
                rtt_ms = 1.0

            self.total_samples += 1
            # Exponential Moving Average (EMA)
            self.smoothed_rtt = (self.alpha * rtt_ms) + ((1.0 - self.alpha) * self.smoothed_rtt)

            if not self.is_adaptive:
                # Return static default if manual mode
                return 88, 0.016, 'MANUAL'

            # Determine appropriate tier based on smoothed RTT
            target_tier = 0
            for idx, (max_rtt, _, _, _, _) in enumerate(self.TIERS):
                if self.smoothed_rtt <= max_rtt:
                    target_tier = idx
                    break

            # Fast downshift (immediate degrade on latency spike)
            if target_tier > self.current_tier_idx:
                self.current_tier_idx = target_tier
                self.consecutive_low_samples = 0
            # Cautious upshift (requires 3 consecutive good samples to upgrade)
            elif target_tier < self.current_tier_idx:
                self.consecutive_low_samples += 1
                if self.consecutive_low_samples >= 3:
                    self.current_tier_idx = target_tier
                    self.consecutive_low_samples = 0
            else:
                self.consecutive_low_samples = 0

            tier = self.TIERS[self.current_tier_idx]
            return tier[1], tier[3], tier[4]

    def record_backpressure_drop(self, count: int = 1) -> tuple[int, float, str]:
        """
        Called when Gateway reports dropped frames due to WebSocket backpressure.
        Immediately penalizes quality and lowers FPS to relieve network.
        """
        with self._lock:
            self.dropped_frames_reported += count
            # Downshift at least one tier or max tier
            if self.current_tier_idx < len(self.TIERS) - 1:
                self.current_tier_idx += 1
            self.consecutive_low_samples = 0
            tier = self.TIERS[self.current_tier_idx]
            return tier[1], tier[3], tier[4]

    def get_current_params(self) -> dict:
        with self._lock:
            tier = self.TIERS[self.current_tier_idx]
            return {
                'isAdaptive': self.is_adaptive,
                'smoothedRtt': round(self.smoothed_rtt, 1),
                'quality': tier[1],
                'fps': tier[2],
                'targetDelaySec': tier[3],
                'tierName': tier[4],
                'totalSamples': self.total_samples,
                'droppedFramesReported': self.dropped_frames_reported
            }

    def reset(self):
        with self._lock:
            self.smoothed_rtt = 25.0
            self.current_tier_idx = 0
            self.consecutive_low_samples = 0
            self.total_samples = 0
            self.dropped_frames_reported = 0

# Global stream controller
stream_controller = AdaptiveStreamController()
