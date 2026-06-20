// i18n dict — profile (Profile + PersonaEditor).
// Usernames/community names are UGC and are NEVER translated — only static chrome lives here.
// Shape contract: export const <ns> = { ko: {...}, en: {...} } as const;
export const profile = {
  ko: {
    // errors / async
    loadError: '내 활동을 불러오지 못했습니다.',
    loadingActivity: '내 활동을 불러오는 중…',

    // not-logged-in gate
    loginRequired: '로그인이 필요합니다.',
    loginHint: '로그인하면 내 글과 커뮤니티를 볼 수 있어요.',
    loginBtn: '[ 로그인 ]',

    // API key section
    apiKeyHeading: 'API 키',
    keyNotSet: '키가 설정되지 않았습니다.',
    keyChangeBtn: '[ 변경 ]',
    keySaveBtn: '[ 저장 ]',
    keyCancelBtn: '[ 숨김 ]',
    keyStorageNote: '키는 이 기기(localStorage)에만 저장됩니다.',

    // logout
    logoutBtn: '[ 로그아웃 ]',

    // section headings (code-comment style)
    communitiesHeading: '// 내가 만든 커뮤니티',
    postsHeading: '// 내 글',
    bookmarksHeading: '// 북마크한 글',

    // empty states — communities
    noCommunityTitle: '아직 만든 커뮤니티가 없어요.',
    noCommunityHint: '새 커뮤니티를 만들어 대화를 시작해 보세요.',
    createCommunityBtn: '[ 커뮤니티 만들기 ]',

    // empty states — posts
    noPostTitle: '아직 작성한 글이 없어요.',
    noPostHint: '커뮤니티에서 첫 글을 남겨 보세요.',

    // empty states — bookmarks
    noBookmarkTitle: '아직 북마크한 글이 없어요.',
    noBookmarkHint: '글 상단의 🔖 로 저장한 글이 여기 모여요.',

    // language settings row (added per spec)
    languageSettingLabel: '언어 설정',

    // PersonaEditor
    personaLabel: 'AI 페르소나 프롬프트',
    personaPlaceholder:
      '예) 당신은 친절한 요리 전문가입니다. 항상 단계별로 쉽게 설명하고, 재료 대체안을 함께 제안하세요.',
    personaHint:
      '이 프롬프트는 커뮤니티의 모든 AI 호출에 적용되는 시스템 지침(systemInstruction)이 됩니다. AI의 말투·역할·관점을 정해 보세요.',
  },
  en: {
    // errors / async
    loadError: 'Failed to load your activity.',
    loadingActivity: 'Loading your activity…',

    // not-logged-in gate
    loginRequired: 'Login required.',
    loginHint: 'Log in to see your posts and communities.',
    loginBtn: '[ Login ]',

    // API key section
    apiKeyHeading: 'API Key',
    keyNotSet: 'No key set.',
    keyChangeBtn: '[ Change ]',
    keySaveBtn: '[ Save ]',
    keyCancelBtn: '[ Hide ]',
    keyStorageNote: 'Your key is stored only on this device (localStorage).',

    // logout
    logoutBtn: '[ Logout ]',

    // section headings (code-comment style)
    communitiesHeading: '// My Communities',
    postsHeading: '// My Posts',
    bookmarksHeading: '// Bookmarked Posts',

    // empty states — communities
    noCommunityTitle: 'No communities yet.',
    noCommunityHint: 'Create a community to start a conversation.',
    createCommunityBtn: '[ Create Community ]',

    // empty states — posts
    noPostTitle: 'No posts yet.',
    noPostHint: 'Be the first to post in a community.',

    // empty states — bookmarks
    noBookmarkTitle: 'No bookmarks yet.',
    noBookmarkHint: 'Posts you save with 🔖 will appear here.',

    // language settings row (added per spec)
    languageSettingLabel: 'Language',

    // PersonaEditor
    personaLabel: 'AI Persona Prompt',
    personaPlaceholder:
      'e.g. You are a friendly cooking expert. Always explain step by step and suggest ingredient substitutions.',
    personaHint:
      'This prompt becomes the system instruction (systemInstruction) applied to every AI call in the community. Use it to set the AI\'s tone, role, and perspective.',
  },
} as const;
