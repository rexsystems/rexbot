/** Soft UI tones via Web Audio. No asset files; volume stays low. */

let shared: AudioContext | undefined;
let pulseTimer: ReturnType<typeof setInterval> | undefined;

function audio(): AudioContext | undefined {
  if (typeof window === "undefined" || !window.AudioContext) return undefined;
  shared ??= new AudioContext();
  return shared;
}

function chirp(freqs: number[], seconds: number, type: OscillatorType = "sine", peak = 0.035) {
  const ctx = audio();
  if (!ctx || document.hidden) return;
  void ctx.resume().catch(() => undefined);
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
  freqs.forEach((frequency, index) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    osc.connect(gain);
    const start = now + index * 0.05;
    osc.start(start);
    osc.stop(now + seconds);
  });
}

/** Short blip while a tool (search, fetch, computer) is running. */
export function playActivityTick() {
  chirp([740], 0.07, "triangle", 0.022);
}

/** Soft rise when a live call connects. */
export function playCallStart() {
  chirp([523.25, 659.25], 0.24, "sine", 0.04);
}

/** Soft fall when a live call ends. */
export function playCallEnd() {
  chirp([659.25, 523.25, 392], 0.3, "sine", 0.038);
}

/** Occasional ticks while work is in progress, not a continuous loop. */
export function startActivityPulse() {
  if (pulseTimer !== undefined) return;
  playActivityTick();
  pulseTimer = setInterval(() => {
    if (!document.hidden) playActivityTick();
  }, 2800);
}

export function stopActivityPulse() {
  if (pulseTimer === undefined) return;
  clearInterval(pulseTimer);
  pulseTimer = undefined;
}
