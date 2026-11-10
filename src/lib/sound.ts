/** Semantic interface cues, generated once and reused without downloads or animation loops. */
export type Cue = 'navigate' | 'tile' | 'confirm' | 'back' | 'expand' | 'collapse';

/** Synthesize a rounded `cue` at `sampleRate` and bake soft room reflections into its cached buffer. */
export function cueSamples(cue: Cue, sampleRate: number): Float32Array {
  const { duration, pitch, gain } = {
    tile: { duration: 0.035, pitch: 330, gain: 0.22 },
    navigate: { duration: 0.05, pitch: 392, gain: 0.22 },
    confirm: { duration: 0.108, pitch: 440, gain: 0.25 },
    back: { duration: 0.086, pitch: 294, gain: 0.23 },
    expand: { duration: 0.09, pitch: 392, gain: 0.18 },
    collapse: { duration: 0.09, pitch: 330, gain: 0.18 },
  }[cue];
  const dryLength = Math.ceil(duration * sampleRate);
  const samples = new Float32Array(dryLength + Math.round(0.24 * sampleRate));
  const reflections = Array.from({ length: 20 }, (_, index) => ({
    offset: Math.round((0.019 + index * 0.011 + Math.sin(index * 2.3) * 0.002) * sampleRate),
    gain: 0.27 * Math.exp(-index / 5) * (index % 3 === 0 ? -1 : 1),
  }));
  for (let i = 0; i < dryLength; i++) {
    const progress = i / Math.max(1, dryLength - 1);
    const envelope = Math.sin(Math.PI * progress) ** 2 * Math.exp(-2 * progress);
    const phase = (2 * Math.PI * i * pitch) / sampleRate;
    const fundamental = gain * envelope * Math.sin(phase);
    samples[i] += fundamental + gain * envelope * 0.14 * Math.sin(phase * 2);
    for (const reflection of reflections)
      samples[i + reflection.offset] += fundamental * reflection.gain;
  }
  return samples;
}

/** Install restrained focus/click feedback. `enabled` is checked at playback, including after unlock.
 * One lazy AudioContext remains ready while the app is visible; disabling sound or hiding suspends it.
 */
export function createSoundFeedback(enabled: () => boolean) {
  let context: AudioContext | undefined;
  const buffers = new Map<Cue, AudioBuffer>();
  const sources = new Set<AudioBufferSourceNode>();
  let lastConfirm = -Infinity;
  let keyboardNavigation = -Infinity;
  let disposed = false;

  /** Schedule `cue` once; rapid repeats and unavailable/blocked audio are deliberately silent. */
  function play(cue: Cue): void {
    const now = performance.now();
    if (disposed || !enabled() || document.hidden) return;
    if (cue !== 'navigate' && cue !== 'tile') lastConfirm = now;
    try {
      context ??= new AudioContext({ latencyHint: 'interactive' });
      const audio = context;
      /** Start only a still-relevant sound after the browser has granted audio playback. */
      function start(): void {
        if (
          disposed ||
          !enabled() ||
          document.hidden ||
          audio.state !== 'running' ||
          performance.now() - now > 1000
        )
          return;
        let buffer = buffers.get(cue);
        if (!buffer) {
          const samples = cueSamples(cue, audio.sampleRate);
          buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
          buffer.getChannelData(0).set(samples);
          buffers.set(cue, buffer);
        }
        const source = audio.createBufferSource();
        source.buffer = buffer;
        source.connect(audio.destination);
        sources.add(source);
        source.onended = () => {
          source.disconnect();
          sources.delete(source);
        };
        source.start();
      }
      if (audio.state === 'running') start();
      else
        void audio
          .resume()
          .then(start)
          .catch(() => {});
    } catch {
      /* Audio availability must never block input or settings. */
    }
  }

  /** Stop active cues immediately when sound is disabled or the window is hidden. */
  function silence(): void {
    for (const source of sources) source.stop();
    sources.clear();
    const audio = context;
    if (audio) void audio.suspend().catch(() => {});
  }

  /** Track physical navigation keys without producing a sound until focus actually moves. */
  function keydown(event: KeyboardEvent): void {
    if (event.key === 'Tab' || event.key.startsWith('Arrow'))
      keyboardNavigation = performance.now();
    if (event.key === 'Escape' && !event.repeat) play('back');
  }
  /** Sound only deliberate focus navigation; suppress focus restoration following confirmation. */
  function focus(event: FocusEvent): void {
    if (!(event.target instanceof HTMLElement) || !event.target.matches('[data-nav]')) return;
    const now = performance.now();
    if (
      (event.target.matches('[data-game]') || now - lastConfirm > 160) &&
      (document.body.classList.contains('controller-input') || now - keyboardNavigation < 120)
    )
      play(event.target.matches('[data-game]') ? 'tile' : 'navigate');
  }
  /** Confirm actionable mouse, keyboard and controller clicks once, ignoring disabled/inert controls. */
  function click(event: MouseEvent): void {
    const target =
      event.target instanceof Element
        ? event.target.closest('button, input[type="checkbox"]')
        : null;
    if (target && !target.matches(':disabled, [data-fullscreen]') && !target.closest('[inert]'))
      play('confirm');
  }
  /** Suspend audio when the document becomes hidden; visibility alone never plays a cue. */
  function visibility(): void {
    if (document.hidden) silence();
  }
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('focusin', focus);
  document.addEventListener('click', click);
  document.addEventListener('visibilitychange', visibility);
  return {
    play,
    silence,
    /** Remove listeners, stop sources and release the native audio device on application teardown. */
    dispose(): void {
      disposed = true;
      silence();
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('click', click);
      document.removeEventListener('visibilitychange', visibility);
      if (context) void context.close().catch(() => {});
    },
  };
}
