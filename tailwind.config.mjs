/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Mike Wolf palette (borrowed from mike-wolf.com v5) — warm light theme.
        bg: '#faf8f4',
        surface: '#ffffff',
        ink: '#1a1a2e',
        warm: '#3d2c1e',
        copper: {
          DEFAULT: '#b87333',
          light: '#f3ece2',
          border: 'rgba(184,115,51,0.15)',
        },
        teal: {
          DEFAULT: '#2a9d8f',
          light: '#eaf5f3',
          border: 'rgba(42,157,143,0.15)',
        },
        muted: '#6b6b7b',
        faint: '#9b9bab',
        rule: 'rgba(26,26,46,0.08)',
        // parchment/border aliases used by ported page markup
        parchment: '#faf8f4',
        border: 'rgba(26,26,46,0.08)',
        amber: {
          DEFAULT: '#b87333',
          light: '#f3ece2',
        },
      },
      fontFamily: {
        serif: ['Literata', 'Georgia', 'Times New Roman', 'serif'],
        display: ['Literata', 'Georgia', 'serif'],
        sans: ['Outfit', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        hero: 'clamp(2.2rem, 5vw, 3.4rem)',
      },
      letterSpacing: {
        eyebrow: '0.2em',
        label: '0.15em',
      },
    },
  },
  plugins: [],
};
