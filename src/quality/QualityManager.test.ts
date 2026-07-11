/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QualityManager } from './QualityManager';

/** defaultLevel() reads location.search at CONSTRUCTION time, so tests that
 * want a non-default `?q=` must set the URL *before* `new QualityManager()`. */
function setSearch(search: string) {
  const url = new URL(window.location.href);
  url.search = search;
  window.history.replaceState(null, '', url.toString());
}

describe('QualityManager', () => {
  beforeEach(() => {
    setSearch('');
  });

  it('defaults to lite with no ?q param', () => {
    const qm = new QualityManager();
    expect(qm.state.level).toBe('lite');
  });

  it('honors ?q=full at construction', () => {
    setSearch('?q=full');
    const qm = new QualityManager();
    expect(qm.state.level).toBe('full');
  });

  it('honors ?q=lite at construction', () => {
    setSearch('?q=lite');
    const qm = new QualityManager();
    expect(qm.state.level).toBe('lite');
  });

  it('ignores an unrecognized ?q value and falls back to lite', () => {
    setSearch('?q=ultra');
    const qm = new QualityManager();
    expect(qm.state.level).toBe('lite');
  });

  it('set() dispatches a change CustomEvent with the new state as detail', () => {
    const qm = new QualityManager();
    const handler = vi.fn();
    qm.addEventListener('change', handler as EventListener);
    qm.set('full');
    expect(handler).toHaveBeenCalledTimes(1);
    const evt = handler.mock.calls[0][0] as CustomEvent;
    expect(evt.detail.level).toBe('full');
    expect(qm.state.level).toBe('full');
  });

  it('set() to the current level is a no-op (no event)', () => {
    const qm = new QualityManager(); // starts lite
    const handler = vi.fn();
    qm.addEventListener('change', handler as EventListener);
    qm.set('lite');
    expect(handler).not.toHaveBeenCalled();
  });

  it('toggle() flips between full and lite', () => {
    const qm = new QualityManager(); // starts lite
    qm.toggle();
    expect(qm.state.level).toBe('full');
    qm.toggle();
    expect(qm.state.level).toBe('lite');
  });

  it('avgFps() is 0 before any tick()', () => {
    const qm = new QualityManager();
    expect(qm.avgFps()).toBe(0);
  });

  describe('with fabricated performance.now sequences', () => {
    let now: number;

    beforeEach(() => {
      now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('emergency-drops from auto-full to lite after <22fps sustained for >=1.5s over >=3 frames', () => {
      setSearch('?q=full');
      const qm = new QualityManager(); // constructs at now=0, capturing lastT/windowStart=0
      expect(qm.state.level).toBe('full');

      // Simulate frames at ~10fps (100ms apart) — well under the 22fps
      // emergency threshold. Need windowFrames >= 3 and elapsed >= 1.5s.
      for (let i = 1; i <= 20; i++) {
        now = i * 100; // 100ms per frame => 10fps, elapsed 2.0s by frame 20
        qm.tick();
        if (qm.state.level === 'lite') break;
      }

      expect(qm.state.level).toBe('lite');
    });

    it('does not emergency-drop when frames stay comfortably above 22fps', () => {
      setSearch('?q=full');
      const qm = new QualityManager();

      // ~60fps for 2s: well above the emergency threshold.
      for (let i = 1; i <= 120; i++) {
        now = i * (1000 / 60);
        qm.tick();
      }

      expect(qm.state.level).toBe('full');
    });

    it('sustained-drops after 180 slow (but not emergency-slow) samples average under 45fps', () => {
      setSearch('?q=full');
      const qm = new QualityManager();

      // 30fps frames: above the 22fps emergency threshold (so the 1.5s
      // window check keeps resetting and never fires) but below the 45fps
      // sustained-average threshold. After 180 samples (the rolling window
      // cap) the sustained check drops to lite.
      const frameMs = 1000 / 30;
      for (let i = 1; i <= 200; i++) {
        now = i * frameMs;
        qm.tick();
        if (qm.state.level === 'lite') break;
      }

      expect(qm.state.level).toBe('lite');
    });

    it('a manual override prevents auto-drop even under sustained low fps', () => {
      setSearch('?q=full');
      const qm = new QualityManager(); // starts full (auto, not yet manual)

      // Any explicit set()/toggle() marks manualOverride = true, even when
      // it round-trips back to the starting level.
      qm.toggle(); // -> lite, manual
      qm.toggle(); // -> full, manual

      for (let i = 1; i <= 20; i++) {
        now = i * 100; // ~10fps
        qm.tick();
      }

      expect(qm.state.level).toBe('full');
    });
  });
});
