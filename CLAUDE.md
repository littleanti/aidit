# Aidit — 프로젝트 작업 규칙 (CLAUDE.md)

## Ground Rules (필수)

### GR-1. 코드 수정 전 문서 먼저 업데이트 (Docs-before-code)
모든 **코드 추가/수정** 작업은 **코드를 건드리기 전에 먼저 문서를 업데이트**한다.

- 적용 대상: 기능 추가(feat)·버그 수정(fix)·동작 변경·리팩터링 등 **소스 코드가 바뀌는 모든 명령**.
- 순서는 항상: **① 문서 업데이트 → ② 코드 수정 → ③ 검증(typecheck/test) → ④ 커밋·푸시**.
- 기본 문서는 [`docs/IMPLEMENTATION_NOTES.md`](./docs/IMPLEMENTATION_NOTES.md)의 변경 이력(Changelog)이다.
  최신 항목을 맨 위에 두고, 태그(`[feat]`/`[fix]`/`[test]`/`[docs]`/`[chore]`)와
  변경 파일 경로를 함께 적는다. 날짜는 절대 날짜로 기록한다.
- 스펙·계약·동작이 바뀌면 관련 상위 문서(`PRD.md`/`TRD.md`/`PLAN.md`/`WIREFRAME.md`)의
  해당 서술도 함께 갱신하고, 옛 서술이 새 동작과 모순되면 정정한다.
- 사소한 오타/포매팅 등 동작이 전혀 바뀌지 않는 변경은 이 규칙에서 제외한다.

## 참고
- 문서 인덱스/구조: `docs/` (PRD·TRD·PLAN·WIREFRAME·DESIGN-SYSTEM·IMPLEMENTATION_NOTES).
- 사용자 노출 문자열은 하드코딩하지 말고 i18n(`t('namespace.key')`, `frontend/src/i18n/dicts/*`)을 사용한다.
