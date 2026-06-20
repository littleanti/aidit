// i18n dict — generic shared labels reused across the app chrome.
// Keep this small and truly cross-cutting; feature-specific strings belong in
// their own namespace (auth, home, thread, post, community, profile, ...).
export const common = {
  ko: {
    login: '로그인',
    logout: '로그아웃',
    cancel: '취소',
    save: '저장',
    confirm: '확인',
    close: '닫기',
    delete: '삭제',
    edit: '수정',
    loading: '불러오는 중…',
    retry: '다시 시도',
    submit: '제출',
  },
  en: {
    login: 'Login',
    logout: 'Logout',
    cancel: 'Cancel',
    save: 'Save',
    confirm: 'Confirm',
    close: 'Close',
    delete: 'Delete',
    edit: 'Edit',
    loading: 'Loading…',
    retry: 'Retry',
    submit: 'Submit',
  },
} as const;
