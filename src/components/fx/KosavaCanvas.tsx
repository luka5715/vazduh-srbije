import { useEffect, useRef } from 'react';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useVisibility } from '@/hooks/useVisibility';
import { cn } from '@/lib/cn';

export interface KosavaCanvasProps {
  /**
   * Gustina i neprozirnost čestica 0–1 (vidi `pmIntensity` u lib/insights: medijana PM10
   * mreže normalizovana na SEPA pragove). Vrednosti van opsega se ograničavaju.
   */
  intensity: number;
  /** Promena ključa (npr. rang izmaglice ili tema) ponovo čita boju `--haze`. */
  colorKey?: string | number | null;
  /** Gornja granica broja čestica (podrazumevano 260 na desktopu, 140 na telefonu). */
  maxParticles?: number;
  /**
   * Mirno polje: tok se odsimulira unapred (tragovi kao u animaciji) i nacrta jednom, bez
   * petlje – npr. pozadina prijave. Ponovo se crta pri promeni veličine i boje.
   */
  still?: boolean;
  className?: string;
}

interface Particle {
  x: number;
  y: number;
  speed: number;
  age: number;
  life: number;
  width: number;
  mote: boolean;
}

/** Košava duva sa jugoistoka ka severozapadu: osnovni pravac ulevo i blago naviše. */
const BASE_ANGLE = Math.PI + 0.32;
const PHONE_CAP = 140;
const DESKTOP_CAP = 260;
/** Najmanji razmak kadrova na telefonu (≈ 30 fps i na 60 i na 120 Hz ekranima). */
const PHONE_FRAME_GAP_MS = 32;
/** Bledenje tragova po kadru (destination-out). */
const FADE_ALPHA = 0.085;
/** Isto bledenje primenjeno svaki drugi kadar: 1 − (1 − 0,085)². */
const PHONE_FADE_ALPHA = 1 - (1 - FADE_ALPHA) ** 2;
const COLOR_REFRESH_FRAMES = 30;
/** Broj unapred simuliranih kadrova mirnog polja (~2 s toka – tragovi su potpuno formirani). */
const STILL_FRAMES = 120;

/** Polje toka: slojeviti sin/cos „šum“ bez biblioteke, sporo se menja kroz vreme. */
function angleAt(x: number, y: number, t: number): number {
  const nx = x / 240;
  const ny = y / 240;
  const n =
    Math.sin(nx * 1.25 + t * 0.00011) * Math.cos(ny * 1.6 - t * 0.00008) +
    0.55 * Math.sin((nx + ny) * 2.2 + t * 0.00019) +
    0.25 * Math.cos(nx * 3.7 - ny * 2.9 + t * 0.00027);
  return BASE_ANGLE + n * 0.8;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.2;
}

/**
 * „Košava“: Canvas 2D polje toka sa česticama koje plutaju i ostavljaju kratke tragove
 * (bledenje preko `destination-out`). Boja je `--haze`, gustina i neprozirnost prate
 * `intensity`. Animira se samo dok je vidljivo (IntersectionObserver + vidljivost kartice),
 * DPR je ograničen na 2, broj čestica ≤ 260 (desktop) / ≤ 140 (telefon). Uz smanjeno
 * kretanje crta jedan statičan kadar (strujnice), a `still` crta mirno polje bez petlje.
 * Dekorativno: aria-hidden.
 */
export function KosavaCanvas({ intensity, colorKey = null, maxParticles, still = false, className }: KosavaCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const visible = useVisibility(canvasRef);
  const reduced = useReducedMotion();
  const level = clamp01(intensity);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.getContext !== 'function') return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) return;
    const context = ctx;

    let width = 0;
    let height = 0;
    let color = 'rgb(95 212 244)';
    let particleAlpha = 0.85;
    let frame = 0;
    let frameCount = 0;
    let last = 0;
    let lastDraw = 0;
    let disposed = false;
    let pause: ReturnType<typeof setTimeout> | undefined;
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

    const readColor = () => {
      const style = getComputedStyle(canvas);
      color = style.color || color;
      const alpha = Number.parseFloat(style.getPropertyValue('--particle-alpha'));
      particleAlpha = Number.isFinite(alpha) ? alpha : 0.85;
    };

    const isPhone = () => coarse || width < 640;

    const targetCount = () => {
      const cap = Math.min(maxParticles ?? Number.POSITIVE_INFINITY, isPhone() ? PHONE_CAP : DESKTOP_CAP);
      const areaScale = Math.max(0.45, Math.min(1, (width * height) / (1100 * 380)));
      return Math.max(12, Math.round(cap * (0.3 + 0.7 * level) * areaScale));
    };

    const spawn = (anywhere: boolean): Particle => {
      let x = Math.random() * width;
      let y = Math.random() * height;
      if (!anywhere && Math.random() < 0.7) {
        // Tok ide ulevo i naviše – nove čestice ulaze sa desne i donje ivice.
        if (Math.random() < 0.65) x = width + 4;
        else y = height + 4;
      }
      const mote = Math.random() < 0.16;
      return {
        x,
        y,
        speed: (mote ? 0.014 : 0.022) + Math.random() * 0.03 + level * 0.012,
        age: anywhere ? Math.random() * 4000 : 0,
        life: 3500 + Math.random() * 5500,
        width: mote ? 1.6 + Math.random() * 1.1 : 0.8 + Math.random() * 0.9,
        mote,
      };
    };

    const syncCount = () => {
      const particles = particlesRef.current;
      const target = targetCount();
      while (particles.length < target) particles.push(spawn(true));
      if (particles.length > target) particles.length = target;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      // Telefon: DPR 1. Polje je meka pozadina (gubitak oštrine je mali), a bledenje tragova
      // (destination-out preko cele površine) svakog kadra je na DPR 2 četiri puta skuplje.
      const dpr = isPhone() ? 1 : Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Posle promene veličine stare pozicije ne važe – raspoređujemo ponovo.
      particlesRef.current = [];
      syncCount();
    };

    const alphaFor = (particle: Particle) => {
      const lifeT = particle.age / particle.life;
      const envelope = Math.sin(Math.PI * Math.min(1, Math.max(0, lifeT)));
      return envelope * particleAlpha * (0.32 + 0.55 * level) * (particle.mote ? 0.9 : 0.75);
    };

    /** Jedan statičan kadar: kratke strujnice duž polja toka (smanjeno kretanje). */
    const drawStatic = () => {
      readColor();
      context.clearRect(0, 0, width, height);
      context.strokeStyle = color;
      context.fillStyle = color;
      context.lineCap = 'round';
      for (const particle of particlesRef.current) {
        let { x, y } = particle;
        context.globalAlpha = particleAlpha * (0.18 + 0.4 * level) * (0.4 + Math.random() * 0.6);
        context.lineWidth = particle.width;
        context.beginPath();
        context.moveTo(x, y);
        for (let step = 0; step < 10; step++) {
          const angle = angleAt(x, y, 0);
          x += Math.cos(angle) * 5;
          y += Math.sin(angle) * 5;
          context.lineTo(x, y);
        }
        context.stroke();
        if (particle.mote) {
          context.beginPath();
          context.arc(x, y, particle.width * 0.8, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.globalAlpha = 1;
    };

    /** Jedan korak toka: bledenje tragova pa pomeranje svih čestica za `dt` ms. */
    const advance = (time: number, dt: number, fade: number = FADE_ALPHA) => {
      if (fade > 0) {
        context.globalCompositeOperation = 'destination-out';
        context.globalAlpha = 1;
        context.fillStyle = `rgba(0, 0, 0, ${fade})`;
        context.fillRect(0, 0, width, height);
      }
      context.globalCompositeOperation = 'source-over';
      context.strokeStyle = color;
      context.fillStyle = color;
      context.lineCap = 'round';

      const particles = particlesRef.current;
      for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        const angle = angleAt(particle.x, particle.y, time);
        const px = particle.x;
        const py = particle.y;
        particle.x += Math.cos(angle) * particle.speed * dt;
        particle.y += Math.sin(angle) * particle.speed * dt;
        particle.age += dt;
        context.globalAlpha = alphaFor(particle);
        context.lineWidth = particle.width;
        context.beginPath();
        context.moveTo(px, py);
        context.lineTo(particle.x, particle.y);
        context.stroke();
        const outside = particle.x < -8 || particle.y < -8 || particle.x > width + 8 || particle.y > height + 8;
        if (outside || particle.age > particle.life) particles[i] = spawn(false);
      }
      context.globalAlpha = 1;
    };

    const step = (time: number) => {
      if (disposed) return;
      // Telefoni: ~30 kadrova u sekundi je dovoljno za spore čestice i štedi bateriju. Sledeći
      // kadar se zakazuje tajmerom (pa rAF), da preskočeni kadrovi ne bude glavnu nit na svaki
      // osvežaj ekrana.
      if (isPhone()) {
        if (time - lastDraw < PHONE_FRAME_GAP_MS - 4) {
          frame = requestAnimationFrame(step);
          return;
        }
        pause = setTimeout(() => {
          pause = undefined;
          if (!disposed) frame = requestAnimationFrame(step);
        }, PHONE_FRAME_GAP_MS - 20);
      } else {
        frame = requestAnimationFrame(step);
      }
      const dt = Math.min(48, last ? time - last : 16);
      last = time;
      lastDraw = time;
      if (frameCount++ % COLOR_REFRESH_FRAMES === 0) readColor();
      // Telefon: bledenje (destination-out preko cele površine – najskuplji deo kadra) svaki
      // drugi kadar, dvostruko jače; tragovi blede istom brzinom, a posla je upola manje.
      advance(time, dt, isPhone() ? (frameCount % 2 === 0 ? PHONE_FADE_ALPHA : 0) : FADE_ALPHA);
    };

    /** Mirno polje: tok se odsimulira unapred, bez petlje (tragovi kao u animaciji). */
    const drawStill = () => {
      readColor();
      context.clearRect(0, 0, width, height);
      for (let i = 0; i < STILL_FRAMES; i++) advance(i * 16, 16);
    };

    resize();
    readColor();

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      resize();
      if (reduced) drawStatic();
      else if (still) drawStill();
      else if (!visible) drawStatic();
    }) : null;
    observer?.observe(canvas);

    let staticTimer: ReturnType<typeof setTimeout> | undefined;
    if (still && !reduced) {
      drawStill();
      // Isto kao za statičan kadar: posle pretapanja `--haze` crta se u konačnoj boji.
      staticTimer = setTimeout(drawStill, 1300);
    } else if (reduced) {
      drawStatic();
      // `--haze` se pretapa 1,2 s – posle toga ponovo crtamo u konačnoj boji.
      staticTimer = setTimeout(drawStatic, 1300);
    } else if (visible) {
      frame = requestAnimationFrame(step);
    } else if (particlesRef.current.length) {
      drawStatic();
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      if (pause) clearTimeout(pause);
      if (staticTimer) clearTimeout(staticTimer);
      observer?.disconnect();
    };
  }, [visible, reduced, level, maxParticles, colorKey, still]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
      style={{ color: 'var(--haze)' }}
    />
  );
}
