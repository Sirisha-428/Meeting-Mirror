/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        teams: {
          purple: '#6264A7',
          dark: '#201f1e',
        },
      },
    },
  },
  plugins: [],
};
