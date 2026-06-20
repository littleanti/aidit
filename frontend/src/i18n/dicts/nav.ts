// i18n dict — navigation chrome (sidebar + bottom tab bar labels).
// Source of the Korean strings: AppLayout.tsx sidebar nav + BottomTabBar.tsx TABS.
// UGC is NEVER translated; these are static app chrome only.
export const nav = {
  ko: {
    home: '홈',
    search: '검색',
    write: '작성',
    me: '나',
    profileAria: '내 프로필로 이동',
    bottomBarAria: '하단 탭',
  },
  en: {
    home: 'Home',
    search: 'Search',
    write: 'Write',
    me: 'Me',
    profileAria: 'Go to my profile',
    bottomBarAria: 'Bottom tabs',
  },
} as const;
