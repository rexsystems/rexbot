import { useEffect, useRef, useState } from "react";
import { DEFAULT_BOT, type BotProfile } from "@rex/shared";

const COLORS = ["#66b8ff", "#f3aa57", "#83cba2", "#b8a3ee", "#eb8ba0"];
const SHAPES: BotProfile["shape"][] = ["orb", "pebble", "cube", "capsule", "diamond"];
let engine: Promise<typeof import("./avatar3d")> | undefined;
function hash(seed: string) { let value = 2166136261; for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return value >>> 0; }

export function BlobAvatar({ seed, size = 40, pulse, float, className = "", appearance }: { seed: string; size?: number; pulse?: boolean; float?: boolean; className?: string; appearance?: BotProfile }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const h = hash(seed);
  const bot = appearance ?? { ...DEFAULT_BOT, color: COLORS[h % COLORS.length]!, shape: SHAPES[(h >>> 8) % SHAPES.length]!, motion: float ? "float" : "still" };
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
