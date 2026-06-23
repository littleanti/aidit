// i18n dict — post creation / cards (CreatePost, PostCard).
// Shape contract: export const <ns> = { ko: {...}, en: {...} } as const;
export const post = {
  ko: {
    // CreatePost — page headings
    heading_create: '글 작성',
    heading_edit: '글 편집',

    // CreatePost — login gate
    login_required: '로그인이 필요해요',
    login_btn: '[ 로그인 ]',

    // CreatePost — community picker
    community_label: '커뮤니티',
    community_prefix: '커뮤니티:',
    community_loading: '불러오는 중…',
    community_placeholder: '커뮤니티 선택',
    community_change: '▾ 변경',
    community_search_placeholder: '커뮤니티 검색',
    community_no_match: '일치하는 커뮤니티가 없어요.',
    community_empty_link: '! 가입한 커뮤니티가 없어요 · 검색에서 만들기 →',
    community_not_found: '커뮤니티 "{slug}"를 찾을 수 없습니다.',

    // CreatePost — form fields
    title_label: '제목',
    title_placeholder: '제목을 입력하세요',
    body_label: '내용',
    body_placeholder: '내용을 입력하세요',

    // CreatePost — image attachment
    image_label: '이미지',
    image_attach_btn: '[+] 이미지 첨부',
    image_attach_hint: 'PNG · JPG',
    image_attach_name: '첨부 이미지',
    image_preview_alt: '첨부 미리보기',
    image_uploading: '이미지 · 업로드 중…',
    image_attached: '이미지 · 첨부됨',
    image_remove_aria: '이미지 제거',
    image_type_error: '지원하지 않는 이미지 형식입니다 (PNG, JPEG, WebP, GIF).',
    image_size_error: '이미지가 너무 큽니다 (최대 5MB).',
    image_upload_error: '이미지 업로드에 실패했습니다.',

    // CreatePost — AI toggle
    ai_first_reply: '게시 후 AI 1차 답변 받기',

    // CreatePost — AI response length
    ai_length_short: '짧게',
    ai_length_normal: '보통',
    ai_length_long: '길게',
    ai_length_aria: 'AI 답변 길이',

    // CreatePost — submit buttons
    btn_submit: '[ 게시하기 ]',
    btn_submitting: '[ 게시 중… ]',
    btn_save: '[ 저장하기 ]',
    btn_saving: '[ 저장 중… ]',

    // CreatePost — error messages
    err_load_post: '글을 불러오지 못했습니다.',
    err_load_communities: '커뮤니티를 불러오지 못했습니다.',
    err_submit_create: '글 작성에 실패했습니다.',
    err_submit_edit: '글 수정에 실패했습니다. 다시 시도해 주세요.',

    // PostCard — relative time
    time_just_now: '방금',
    time_minutes: '{n}분',
    time_hours: '{n}시간',
    time_days: '{n}일',
    time_weeks: '{n}주',

    // PostCard — attached image alt
    attached_image_alt: '첨부 이미지',

    // PostCard — upvote
    upvote_aria: '추천',
    unvote_aria: '추천 취소',
    comment_count_aria: '댓글 수',
  },
  en: {
    // CreatePost — page headings
    heading_create: 'Write Post',
    heading_edit: 'Edit Post',

    // CreatePost — login gate
    login_required: 'Please log in to continue',
    login_btn: '[ Log In ]',

    // CreatePost — community picker
    community_label: 'Community',
    community_prefix: 'Community:',
    community_loading: 'Loading…',
    community_placeholder: 'Select community',
    community_change: '▾ Change',
    community_search_placeholder: 'Search communities',
    community_no_match: 'No matching communities.',
    community_empty_link: '! No communities joined · Create one from Search →',
    community_not_found: 'Community "{slug}" not found.',

    // CreatePost — form fields
    title_label: 'Title',
    title_placeholder: 'Enter a title',
    body_label: 'Body',
    body_placeholder: 'Enter body text',

    // CreatePost — image attachment
    image_label: 'Image',
    image_attach_btn: '[+] Attach Image',
    image_attach_hint: 'PNG · JPG',
    image_attach_name: 'Attached image',
    image_preview_alt: 'Attachment preview',
    image_uploading: 'Image · Uploading…',
    image_attached: 'Image · Attached',
    image_remove_aria: 'Remove image',
    image_type_error: 'Unsupported image format (PNG, JPEG, WebP, GIF).',
    image_size_error: 'Image is too large (max 5 MB).',
    image_upload_error: 'Image upload failed.',

    // CreatePost — AI toggle
    ai_first_reply: 'Get first AI reply after posting',

    // CreatePost — AI response length
    ai_length_short: 'Short',
    ai_length_normal: 'Normal',
    ai_length_long: 'Long',
    ai_length_aria: 'AI response length',

    // CreatePost — submit buttons
    btn_submit: '[ Post ]',
    btn_submitting: '[ Posting… ]',
    btn_save: '[ Save ]',
    btn_saving: '[ Saving… ]',

    // CreatePost — error messages
    err_load_post: 'Failed to load post.',
    err_load_communities: 'Failed to load communities.',
    err_submit_create: 'Failed to submit post.',
    err_submit_edit: 'Failed to save changes. Please try again.',

    // PostCard — relative time
    time_just_now: 'just now',
    time_minutes: '{n}m',
    time_hours: '{n}h',
    time_days: '{n}d',
    time_weeks: '{n}w',

    // PostCard — attached image alt
    attached_image_alt: 'Attached image',

    // PostCard — upvote
    upvote_aria: 'Upvote',
    unvote_aria: 'Remove upvote',
    comment_count_aria: 'Comment count',
  },
} as const;
