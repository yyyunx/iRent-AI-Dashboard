/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        irent: {
          red: '#c62828',
          'red-hover': '#b71c1c',
          bg: '#f5f5f5',
          panel: '#ffffff',
          ink: '#1f1f1f',
          muted: '#6f6f6f',
          line: '#ececec',
          green: '#2e7d32',
          orange: '#f9a825',
          danger: '#d32f2f',
          'soft-red': '#fff3f3',
          'soft-red-strong': '#fde5e5',
        }
      },
      boxShadow: {
        premium: '0 12px 30px rgba(31, 31, 31, 0.08)',
        hover: '0 18px 42px rgba(198, 40, 40, 0.14)',
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans TC', 'Segoe UI', 'Arial', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
