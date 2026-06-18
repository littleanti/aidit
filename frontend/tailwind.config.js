/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        // mobile-first: base is 360-430px single column.
        tablet: '768px',
        desktop: '1024px',
      },
      maxWidth: {
        app: '640px',
      },
      colors: {
        brand: {
          DEFAULT: '#7c3aed',
          dark: '#6d28d9',
        },
      },
    },
  },
  plugins: [],
};
