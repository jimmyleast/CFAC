/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        gold: '#C9A84C',
        'gold-light': '#E8D5A3',
        'gold-dark': '#8B6914',
        bg: '#0D0D0F',
        surface: '#141416',
        'surface-2': '#1C1C20',
        'surface-3': '#242428',
        border: 'rgba(201,168,76,0.2)',
        'border-soft': 'rgba(255,255,255,0.06)',
        text: '#F0EDE6',
        'text-muted': '#8A8680',
        'text-dim': '#555250',
      },
      fontFamily: {
        serif: ['DM Serif Display', 'serif'],
        sans: ['DM Sans', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
