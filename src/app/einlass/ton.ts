// Rückmeldung per Ton (WebAudio) und Vibration
let ctx: AudioContext | null = null;

/** Muss einmal in einer Nutzeraktion aufgerufen werden (Autoplay-Regeln der Browser) */
export function tonFreischalten() {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* kein Audio */ }
}

function ton(freq: number, start: number, dauer: number, typ: OscillatorType = 'sine') {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = typ;
  o.frequency.value = freq;
  const t = ctx.currentTime + start;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.4, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dauer);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dauer + 0.02);
}

export function rueckmeldung(ok: boolean, hinweis = false, einst: { ton: boolean; vibration: boolean } = { ton: true, vibration: true }) {
  if (einst.vibration) {
    try { navigator.vibrate?.(ok ? (hinweis ? [80, 60, 80] : 80) : [250, 100, 250]); } catch { /* nicht unterstützt */ }
  }
  if (!einst.ton) return;
  if (ok) {
    ton(1046, 0, 0.12);
    ton(hinweis ? 784 : 1568, 0.14, 0.16);
  } else {
    ton(196, 0, 0.5, 'square');
    ton(165, 0.55, 0.4, 'square');
  }
}
