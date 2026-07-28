// i18n dict — condensed discussion documents (FR-13): the Document screen
// (/d/:documentId) and the community "문서" tab.
// Shape contract: export const <ns> = { ko: {...}, en: {...} } as const;
export const document = {
  ko: {
    // --- Document screen ---
    title: '문서',
    tag: '★ 응결된 문서',
    loading: '문서 불러오는 중…',
    loadError: '문서를 불러오지 못했습니다.',
    notFoundTitle: '문서를 찾을 수 없습니다',
    notFoundHint: '삭제되었거나 잘못된 주소입니다.',
    notFoundAction: '[ 홈으로 ]',
    backAria: '뒤로',
    viewThread: '[ 원본 스레드 보기 ]',
    // provenance (FR-13.4)
    provenance: '출처: 세그먼트 #{segment} · 대화 {turns}턴까지 정리',
    meta: 'u/{author} · {time}',
    anonymous: '익명',
    // --- Community documents tab ---
    tabLabel: '문서',
    tabLabelWithCount: '문서 {count}',
    emptyTitle: '아직 응결된 문서가 없습니다',
    emptyHint: '스레드 메뉴의 [ 문서로 정리 ]로 논의를 문서로 만들 수 있어요',
    listError: '문서 목록을 불러오지 못했습니다.',
    loadMore: '[ 더 보기 ]',
    fromPost: '원본: {title}',
  },
  en: {
    title: 'Document',
    tag: '★ CONDENSED DOC',
    loading: 'Loading document…',
    loadError: 'Could not load the document.',
    notFoundTitle: 'Document not found',
    notFoundHint: 'It was deleted, or the address is wrong.',
    notFoundAction: '[ Go home ]',
    backAria: 'Back',
    viewThread: '[ View the original thread ]',
    provenance: 'Source: segment #{segment} · condensed through turn {turns}',
    meta: 'u/{author} · {time}',
    anonymous: 'anonymous',
    tabLabel: 'Docs',
    tabLabelWithCount: 'Docs {count}',
    emptyTitle: 'No condensed documents yet',
    emptyHint: 'Use [ Condense to doc ] in the thread menu to turn a discussion into a document',
    listError: 'Could not load the document list.',
    loadMore: '[ Load more ]',
    fromPost: 'From: {title}',
  },
} as const;
