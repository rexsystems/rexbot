import { useEffect, useRef, useState } from "react";
import { DEFAULT_BOT, type BotProfile } from "@rex/shared";

const SHAPES: BotProfile["shape"][] = ["orb", "pebble", "cube", "capsule", "diamond"];
let engine: Promise<typeof import("./avatar3d")> | undefined;
function hash(seed: string) { let value = 2166136261; for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return value >>> 0; }
/** Deterministic fallback color from seed when no profile is provided (full hue range). */
function colorFromSeed(seed: string): string {
  const h = hash(seed);
  const hue = h % 360;
  const sat = 0.52 + ((h >>> 9) % 40) / 100;
  const light = 0.45 + ((h >>> 17) % 25) / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0, g = 0, b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const byte = (n: number) => Math.max(0, Math.min(255, Math.round((n + m) * 255))).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

export function BlobAvatar({ seed, size = 40, pulse, float, className = "", appearance }: { seed: string; size?: number; pulse?: boolean; float?: boolean; className?: string; appearance?: BotProfile }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const h = hash(seed);
  const bot = appearance ?? { ...DEFAULT_BOT, color: colorFromSeed(seed), shape: SHAPES[(h >>> 8) % SHAPES.length]!, motion: float ? "float" : "still" };
  const { color, shape, motion, blink } = bot;
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    engine ??= import("./avatar3d");
    engine.then(({ mountAvatar }) => {
      if (!cancelled && canvas.current) dispose = mountAvatar(canvas.current, { ...DEFAULT_BOT, color, shape, motion, blink });
    }).catch(() => { if (!cancelled) setUnavailable(true); });
    return () => { cancelled = true; dispose?.(); };
  }, [color, shape, motion, blink]);
  return <span className={`bot-avatar bot-motion-${motion}${pulse ? " bot-busy" : ""} ${className}`} data-shape={shape} data-color={color} style={{ width: size, height: size }} aria-hidden="true" title={unavailable ? "3D rendering is unavailable on this device" : undefined}>
    {unavailable ? <span className="avatar-unavailable" style={{ backgroundColor: color }}>3D</span> : <canvas ref={canvas} className="bot-avatar-canvas" width={size * 2} height={size * 2} />}
  </span>;
}

export function OrbitDots({ active }: { active?: boolean }) {
  return <span className={`orbit-dots${active ? " orbit-on" : ""}`} aria-hidden="true"><i /><i /><i /></span>;
}
