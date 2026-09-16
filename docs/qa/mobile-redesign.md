# 모바일 전용 화면 검증

- 날짜: 2026-09-16
- 대상: 도구 탐색, 상세, 커뮤니티, 글쓰기, 내 활동, 로그인 및 공통 화면
- 로컬 대상: `http://127.0.0.1:8096` (운영 빌드, 격리된 PostgreSQL 테스트 스키마)
- 실행: `pnpm check`, `pnpm test`, `pnpm build`, `pnpm test:e2e`
- 소스 식별: `source-revision.json`의 SHA-256
- 자동화: `test/e2e/mobile.spec.ts`, 기존 `site.spec.ts`와 `icons.spec.ts`

## 화면과 사용 흐름

모바일 상단 헤더·하단 4개 메뉴, 검색 중심 홈과 도구 카드, 분야별 가로 탐색, 아래에서 여는 필터 창을 새로 구성했다. 상세 내용은 가능한 범위·제작 요청문·참고 정보로 구분하고, 작성 화면은 게시판과 관련 도구를 먼저 선택한다. 내 활동은 저장·작성 기록을 프로필 설정보다 먼저 보여준다.

같은 URL·서버 데이터·계정·API를 사용한다. JS가 없는 환경에서는 필터 폼과 상세 내용을 모두 표시한다. 760px 이하가 모바일 전용 구성이고 761px 이상은 기존 데스크톱 탐색 구조다.

## 재현 가능한 검증

| 범위 | 확인 내용 |
| --- | --- |
| 탐색 | 첫 화면의 카드 노출, 한글 검색, 필터 취소·초기화·적용, 검색 후 필터 재사용, URL 복원, 페이지 이동과 분야 전환 |
| 상세 | 내용 전환, 해시 링크와 뒤로가기, Claude Code·Codex·Cursor 요청문 전문 복사, FAQ, 데스크톱 크기로 변경했을 때 전체 내용 복원 |
| 화면 | 360·390·760·768px 주요 화면의 가로 넘침, 다크·라이트, 테마 유지, 하단 메뉴와 로그인 복귀 경로 |
| 작성·계정 | 격리된 테스트 계정으로 가입, 도구 저장, 글 작성·수정, 댓글, 프로필 저장 |
| 접근성·점진적 향상 | dialog의 키보드 닫기와 포커스 복귀, 취소 시 미적용, JS 없이 요금 필터 제출 |
| 기존 기능 | 전체 121개 상세, 데스크톱 검색·정렬·페이지 이동, 아이콘, 계정·권한·업로드·댓글·운영 API 회귀 검사 |

실행 결과는 `browser-summary.json`에 기록한다. Chromium의 휴대폰 화면·터치 에뮬레이션을 사용했으며 실제 iOS/Android 기기 검증은 포함하지 않는다. 테스트 계정과 글은 운영 DB와 분리된 스키마에 생성하고 테스트 서버 종료 때 정리한다.

## 직접 확인한 화면

- [390px 다크 홈](screenshots/mobile-home-dark-390.png)
- [360px 라이트 홈](screenshots/mobile-home-light-360.png)
- [필터 창](screenshots/mobile-filters.png)
- [도구 상세](screenshots/mobile-tool-overview.png)
- [제작 요청문](screenshots/mobile-tool-prompt.png)
- [커뮤니티](screenshots/mobile-community-light-360.png)
- [글쓰기](screenshots/mobile-editor.png)
- [로그인](screenshots/mobile-login-light-360.png)

검색 결과를 DOM으로 교체할 때 noscript 내부 스타일이 활성화되어 필터 버튼이 사라지는 문제를 발견했다. 스타일 삽입을 제거하고 클라이언트 활성 상태에 따라 기본 폼과 dialog를 전환하도록 수정한 뒤 검색·필터·JS 없는 제출을 다시 검증했다.
