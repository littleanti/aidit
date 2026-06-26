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
      // GREEN-PHOSPHOR CRT RETRO TERMINAL palette (term-* tokens).
      // Single source of truth for the retro migration. Anchored on the
      // deep-phosphor backdrop (#04130b). A single `colors.term` map resolves
      // for every Tailwind color utility family (text-*, bg-*, border-*,
      // ring-*, divide-*, etc.), so e.g. `text-term-title`, `bg-term-card`,
      // and `border-term-cta` all work from one definition.
      colors: {
        term: {
          // surfaces
          bg: '#020a05', // app backdrop
          screen: '#04130b', // CRT screen base (also see backgroundImage.term-screen)
          card: '#04130b', // card / panel surface
          tag: '#04130b', // corner tag fill
          input: '#03100a', // form field surface
          info: '#06190e', // info box surface
          hover: '#072115', // hover surface
          // borders
          border: '#1d4a30', // default phosphor border
          // phosphor text
          title: '#7dffa0', // bright phosphor headings
          bright: '#aaffc0', // brightest phosphor / focused border / ring
          dim: '#4fbf72', // secondary / meta text
          faint: '#2f8a52', // labels, corner tags, hints
          amber: '#ffcf6b', // warm accent (warnings / highlights)
          danger: '#ff6b6b', // error text / border
          cta: '#3fa564', // primary CTA border / accent
        },
      },
      fontFamily: {
        // 형제 앱 Aidit-Code와 글자단위 동일. 라틴=시스템 고정폭(Consolas 등),
        // 한글=고정폭 코딩 폰트(D2Coding→NanumGothicCoding, 로컬 설치 시).
        // 끝에 `monospace` generic을 두지 않는다(의도적): generic으로 끝나면 Chrome이
        // 한글을 비례폭 Malgun으로 폴백시켜 D2Coding(고정폭)을 건너뛴다. (docs/DESIGN-SYSTEM.md §2)
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'SF Mono',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'D2Coding',
          'NanumGothicCoding',
        ],
      },
      backgroundImage: {
        // CRT screen wash: subtle vertical phosphor falloff over the deep base.
        'term-screen':
          'radial-gradient(120% 80% at 50% 0%, #06190e 0%, #04130b 55%, #020a05 100%)',
        // Primary CTA fill (raised phosphor button).
        'term-cta': 'linear-gradient(180deg, #155230 0%, #0c3a20 100%)',
      },
      boxShadow: {
        'glow-cta': '0 0 6px rgba(125, 255, 160, 0.45), inset 0 0 4px rgba(125, 255, 160, 0.15)',
        'glow-soft': '0 0 4px rgba(125, 255, 160, 0.25)',
      },
    },
  },
  plugins: [],
};
