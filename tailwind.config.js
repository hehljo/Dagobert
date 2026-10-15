/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ios: {
          bg: '#F2F2F7',
          darkBg: '#000000',
          card: '#FFFFFF',
          darkCard: '#1C1C1E',
          cardSecondary: '#F9F9FB',
          darkCardSecondary: '#2C2C2E',
          tint: '#0A84FF',
          green: '#30D158',
          red: '#FF453A',
          orange: '#FF9F0A',
          yellow: '#FFD60A',
          purple: '#BF5AF2',
          teal: '#64D2FF',
          gray: '#8E8E93',
          gray2: '#AEAEB2',
          separator: 'rgba(60, 60, 67, 0.12)',
          darkSeparator: 'rgba(84, 84, 88, 0.36)',
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', '"SF Pro Text"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      }
    },
  },
  plugins: [],
};
