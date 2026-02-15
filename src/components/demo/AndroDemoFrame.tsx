/**
 * AndroDemoFrame — Wraps the demo lookup module inside a stylized
 * Andro IA mascot face silhouette. The face acts as a visual frame
 * with a "visor" cutout where the demo content sits.
 *
 * Uses inline SVG with a mask to create the window region.
 * Respects prefers-reduced-motion for the breathing animation.
 */

import { type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

export function AndroDemoFrame({ children }: Props) {
  return (
    <div className="relative w-full max-w-4xl mx-auto px-4">
      {/* ── Mascot face silhouette (desktop: visible, mobile: simplified accents) ── */}
      <div className="hidden md:block absolute inset-0 pointer-events-none" aria-hidden="true">
        <svg
          viewBox="0 0 800 700"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full andro-frame-breathe"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            {/* Gradient for the face fill */}
            <linearGradient id="faceGrad" x1="400" y1="0" x2="400" y2="700" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.08" />
              <stop offset="50%" stopColor="hsl(var(--primary))" stopOpacity="0.05" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.02" />
            </linearGradient>

            {/* Glow around the visor cutout */}
            <filter id="visorGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="8" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>

            {/* Soft outer shadow for depth */}
            <filter id="faceShadow">
              <feDropShadow dx="0" dy="4" stdDeviation="12" floodColor="hsl(var(--primary))" floodOpacity="0.08" />
            </filter>
          </defs>

          {/* ── Head outline ── */}
          {/* 
            A rounded-rectangle head shape with a slight chin taper.
            The central "visor" area is left open for the demo module.
          */}
          <path
            d="
              M 400 30
              C 560 30, 680 100, 700 220
              C 720 340, 700 460, 660 530
              C 620 600, 540 660, 400 670
              C 260 660, 180 600, 140 530
              C 100 460, 80 340, 100 220
              C 120 100, 240 30, 400 30
              Z
            "
            fill="url(#faceGrad)"
            stroke="hsl(var(--primary))"
            strokeWidth="1.5"
            strokeOpacity="0.12"
            filter="url(#faceShadow)"
          />

          {/* ── Antenna ── */}
          <line
            x1="400" y1="30" x2="400" y2="0"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            strokeOpacity="0.15"
            strokeLinecap="round"
          />
          <circle
            cx="400" cy="0" r="5"
            fill="hsl(var(--primary))"
            fillOpacity="0.12"
          />

          {/* ── Eyes (above the visor) ── */}
          <ellipse
            cx="290" cy="175"
            rx="28" ry="20"
            fill="hsl(var(--primary))"
            fillOpacity="0.06"
            stroke="hsl(var(--primary))"
            strokeWidth="1"
            strokeOpacity="0.1"
          />
          <ellipse
            cx="510" cy="175"
            rx="28" ry="20"
            fill="hsl(var(--primary))"
            fillOpacity="0.06"
            stroke="hsl(var(--primary))"
            strokeWidth="1"
            strokeOpacity="0.1"
          />
          {/* Eye pupils */}
          <circle cx="290" cy="175" r="8" fill="hsl(var(--primary))" fillOpacity="0.1" />
          <circle cx="510" cy="175" r="8" fill="hsl(var(--primary))" fillOpacity="0.1" />

          {/* ── Visor border glow ── */}
          <rect
            x="120" y="220" width="560" height="320" rx="24"
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="1.5"
            strokeOpacity="0.08"
            filter="url(#visorGlow)"
          />

          {/* ── Mouth (below the visor) ── */}
          <path
            d="M 340 580 Q 400 610, 460 580"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            strokeOpacity="0.1"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* ── Mobile: subtle top/bottom accent lines ── */}
      <div className="md:hidden mb-4" aria-hidden="true">
        <svg viewBox="0 0 400 40" className="w-full h-8 andro-frame-breathe" preserveAspectRatio="xMidYMid meet">
          <path
            d="M 40 35 Q 200 5, 360 35"
            stroke="hsl(var(--primary))"
            strokeWidth="1.5"
            strokeOpacity="0.15"
            fill="none"
            strokeLinecap="round"
          />
          {/* Mini eyes */}
          <circle cx="160" cy="22" r="4" fill="hsl(var(--primary))" fillOpacity="0.1" />
          <circle cx="240" cy="22" r="4" fill="hsl(var(--primary))" fillOpacity="0.1" />
          {/* Antenna */}
          <line x1="200" y1="8" x2="200" y2="0" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeOpacity="0.15" strokeLinecap="round" />
          <circle cx="200" cy="0" r="2.5" fill="hsl(var(--primary))" fillOpacity="0.12" />
        </svg>
      </div>

      {/* ── Demo content (the "visor" area) ── */}
      <div className="relative z-10">
        <div className="
          md:bg-card/80 md:backdrop-blur-sm
          md:border md:border-border/30
          md:rounded-2xl md:shadow-lg
          md:px-8 md:py-10
        ">
          {children}
        </div>
      </div>

      {/* ── Mobile: bottom accent ── */}
      <div className="md:hidden mt-4" aria-hidden="true">
        <svg viewBox="0 0 400 30" className="w-full h-6" preserveAspectRatio="xMidYMid meet">
          <path
            d="M 100 5 Q 200 28, 300 5"
            stroke="hsl(var(--primary))"
            strokeWidth="1.5"
            strokeOpacity="0.12"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
