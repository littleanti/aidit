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
          50: '#EFEDFE',
          100: '#E2DDFD',
          200: '#C8BEFB',
          300: '#AC9CF9',
          400: '#8E76F9',
          500: '#6848F8',
          600: '#5733E6',
          700: '#4424C0',
          DEFAULT: '#6848F8',
          dark: '#5733E6',
        },
        ink: '#15132E',
        canvas: '#F6F5FB',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(140deg, #5B6CF5 0%, #6848F8 55%, #8B5CF6 100%)',
      },
    },
  },
  plugins: [],
};
