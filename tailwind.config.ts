import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Cormorant Garamond', 'Georgia', 'serif'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // Gold color scale
        gold: {
          50: "hsl(45 100% 95%)",
          100: "hsl(45 95% 88%)",
          200: "hsl(44 90% 75%)",
          300: "hsl(43 88% 65%)",
          400: "hsl(43 85% 55%)",
          500: "hsl(42 80% 48%)",
          600: "hsl(40 75% 40%)",
          700: "hsl(38 70% 32%)",
          800: "hsl(36 65% 24%)",
          900: "hsl(34 60% 16%)",
        },
        status: {
          drafted: "hsl(var(--status-drafted))",
          sent: "hsl(var(--status-sent))",
          pending: "hsl(var(--status-pending))",
          received: "hsl(var(--status-received))",
          confirmed: "hsl(var(--status-confirmed))",
          active: "hsl(var(--status-active))",
          closed: "hsl(var(--status-closed))",
        },
        sla: {
          safe: "hsl(var(--sla-safe))",
          warning: "hsl(var(--sla-warning))",
          critical: "hsl(var(--sla-critical))",
        },
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        'gold': '0 4px 20px -4px hsl(43 85% 55% / 0.25)',
        'gold-lg': '0 8px 32px -8px hsl(43 85% 55% / 0.35)',
        'gold-glow': '0 0 24px 6px hsl(43 85% 55% / 0.45), 0 4px 16px -4px hsl(43 85% 55% / 0.3)',
        'gold-subtle': '0 0 12px 2px hsl(43 85% 55% / 0.15)',
        'card': '0 4px 24px -8px hsl(0 0% 0% / 0.5)',
        'elevated': '0 8px 32px -8px hsl(0 0% 0% / 0.6)',
        'inner-gold': 'inset 0 1px 0 0 hsl(43 85% 55% / 0.1)',
      },
      backgroundImage: {
        'gradient-gold': 'linear-gradient(135deg, hsl(43 85% 55%) 0%, hsl(40 70% 45%) 100%)',
        'gradient-dark': 'linear-gradient(180deg, hsl(220 20% 8%) 0%, hsl(220 20% 4%) 100%)',
        'gradient-card': 'linear-gradient(145deg, hsl(220 18% 12%) 0%, hsl(220 18% 8%) 100%)',
        'gradient-gold-subtle': 'linear-gradient(135deg, hsl(43 85% 55% / 0.1) 0%, transparent 100%)',
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-slow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "glow": {
          "0%, 100%": { boxShadow: "0 0 0 0 hsl(43 85% 55% / 0.4)" },
          "50%": { boxShadow: "0 0 20px 4px hsl(43 85% 55% / 0.2)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-slow": "pulse-slow 2s ease-in-out infinite",
        "slide-in-right": "slide-in-right 0.3s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
        "shimmer": "shimmer 2s linear infinite",
        "glow": "glow 2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;