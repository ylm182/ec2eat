"use client";
import { useEffect, useRef } from "react";

/** A short, transparent celebration; never intercepts touch or keyboard input. */
export function SelectionFireworks({ onDone }: { onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) { done.current(); return; }
    const context = canvas.current?.getContext("2d");
    if (!context) { done.current(); return; }
    let width = 0, height = 0, frame = 0, finished = false;
    const resize = () => {
      width = window.innerWidth; height = window.innerHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.current!.width = width * ratio;
      canvas.current!.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const colors = ["#f43f85", "#ffb700", "#8759ed", "#00b8a0", "#329bff"];
    const bursts = [0, 480, 960, 1440].map((delay, i) => ({
      delay, x: [0.3, 0.72, 0.48, 0.62][i], y: [0.3, 0.4, 0.23, 0.32][i],
      rays: Array.from({ length: 40 }, (_, j) => ({
        angle: j * Math.PI * 2 / 40, speed: 65 + Math.random() * 95,
        color: colors[(i + j) % colors.length],
      })),
    }));
    const start = performance.now();
    const finish = () => {
      if (finished) return;
      finished = true; cancelAnimationFrame(frame); done.current();
    };
    const draw = (now: number) => {
      if (finished) return;
      context.clearRect(0, 0, width, height);
      const elapsed = now - start;
      for (const burst of bursts) {
        const age = elapsed - burst.delay;
        if (age < 0 || age > 2300) continue;
        const x = width * burst.x, y = height * burst.y;
        if (age < 650) {
          const progress = age / 650;
          const rocketY = height - (height - y) * (1 - (1 - progress) ** 2);
          context.globalAlpha = 1;
          context.strokeStyle = burst.rays[0].color;
          context.lineWidth = 3;
          context.beginPath(); context.moveTo(x, rocketY + 18); context.lineTo(x, rocketY); context.stroke();
        } else {
          const t = (age - 650) / 1000;
          context.globalAlpha = Math.max(0, 1 - t / 1.65);
          for (const ray of burst.rays) {
            context.fillStyle = ray.color;
            context.beginPath();
            context.arc(x + Math.cos(ray.angle) * ray.speed * t,
              y + Math.sin(ray.angle) * ray.speed * t + 45 * t * t,
              2.5, 0, Math.PI * 2);
            context.fill();
          }
        }
      }
      if (elapsed >= 3900) finish();
      else frame = requestAnimationFrame(draw);
    };
    const visibility = () => { if (document.hidden) finish(); };
    const motion = () => { if (reduced.matches) finish(); };
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    reduced.addEventListener("change", motion);
    const timer = window.setTimeout(finish, 4000);
    frame = requestAnimationFrame(draw);
    return () => {
      finished = true; cancelAnimationFrame(frame); clearTimeout(timer);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", motion);
    };
  }, []);
  return <canvas ref={canvas} className="selection-fireworks" aria-hidden="true" />;
}
