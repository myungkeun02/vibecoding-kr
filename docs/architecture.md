# 구조·데이터·권한·통계

## 요청과 실행

Astro server output + Node standalone adapter가 HTML을 렌더링한다. `src/middleware.ts`가 서명된 익명/CSRF 쿠키와 서버 세션을 읽고 보안 헤더·최소 이벤트를 처리한다. 주요 화면은 JS 없이 읽을 수 있고 가입 등 기본 폼 제출도 작동한다. `src/scripts/client.ts`가 검색 결과 갱신·클립보드·인증·반응·업로드를 점진적으로 추가한다.

프로덕션은 **Node 웹 서비스 + PostgreSQL + 업로드용 영속 볼륨**이다. pg 연결 풀은 기본 5개이며 트랜잭션 안의 질의는 같은 연결을 사용한다. 외래 키·고유 제약·원자적 요청 제한과 일회성 인증 토큰 행 잠금으로 동시 요청의 일관성을 지킨다. 업로드를 로컬 볼륨에 보관하므로 웹 서비스는 한 인스턴스로 운영한다. 마이그레이션은 `migrations/postgres`에서 적용한다.

## 편집 데이터와 런타임 데이터

`data/apps/<slug>.json` → `src/lib/schema.ts` 검사 → `src/lib/apps.ts` 공개 항목 로드 → `syncTools()` 메타데이터 UPSERT. 과거 도구는 active=0으로 남겨 글·투표 참조를 보존한다. runtime UPDATE가 원본 JSON을 바꾸지 않는다. `syncTools()`는 공개 도구를 `services`에 최초 삽입하며, 이후 승인된 기본 정보와 가이드는 덮어쓰지 않는다. 홈·검색·분야·상세는 이 공동 목록을 읽고 JSON의 추가 근거 자료를 결합한다. 기존 plan의 샘플 JSON 생성 코드나 초기화 코드를 운영에서 실행하지 않는다.

`migrations/*.sql`은 정렬된 버전으로 1회씩 트랜잭션 적용한다. 현재 001 기본 테이블, 002 동의·인덱스, 003 이메일 확인 시각이다. 적용 기록이 있는 마이그레이션은 수정하지 않고 새 파일을 추가한다. seed는 계정·글·투표를 초기화하지 않는다. 현재 PostgreSQL 마이그레이션은 `migrations/postgres`의 001 기본 구조, 002 SaaS 등록, 003 공동 카탈로그이며 SQLite 마이그레이션은 가져오기 호환용으로 유지한다.

| 테이블                           | 책임·참조 정책                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| tools                            | slug 기본키, 기준 월 비용, 메타데이터 JSON, 활성 여부                                        |
| users                            | 이메일·닉네임 unique, salted scrypt, bio, role/status, email_verified_at                     |
| sessions / identities / consents | 세션 토큰은 SHA-256 해시, 사용자 삭제 cascade, OAuth provider+subject unique, 동의 버전·시각 |
| auth_tokens                      | 이메일 확인/비밀번호 재설정용 해시·종류·만료. 30분·일회성                                    |
| votes                            | slug+user / slug+anonymous 각각 unique; 계정 삭제 cascade                                    |
| posts / comments                 | 작성자 FK SET NULL, 상태로 숨김/삭제. 글 삭제 시 본문·제작 기록·하위 댓글 비움               |
| reactions / bookmarks            | 사용자+글+종류, 사용자+도구 unique. 삭제 글의 반응 제거                                      |
| notifications                    | 사용자·글·댓글 참조, 읽음. 삭제 대상 알림 제거, 숨긴 대상 목록 제외                          |
| reports / suggestions / audit    | 신고 중복 제약, 제안 검토 상태, 관리자 조치 기록. 탈퇴 시 actor/user 참조 NULL               |
| waitlist                         | 이메일 unique, 동의 문구·시각, 임의 철회 토큰, 철회 상태                                     |
| analytics / rate_limits          | 날짜·이벤트·경로 유형의 집계, 단기 요청 횟수                                                 |
| uploads                          | 이미지 소유자·storage·크기·타입. 게시 전에는 소유자만 읽음                                   |
| mail_deliveries                  | 다이제스트 발송 시 생성, campaign+email unique                                               |

SQL 실행은 `src/lib/db.ts`의 바인딩 헬퍼로 통일하되 기능별 SQL은 API에도 둔다. 이 크기의 서비스에서 다층 repository 추상화를 추가하지 않았다.

## 권한과 인증

비회원: 공개 페이지 읽기·검색·프롬프트 복사·익명 대체 인증·소식 구독. 회원: 글·댓글·반응·북마크·신고·제안·본인 정보 관리. 작성자만 글·댓글 수정·삭제. 관리자: 제한·숨김·복구·공지·신고·제안·감사. 관리자는 별도 Google 인증·admin_members·admin_sessions로 확인하며 일반 users.role을 신뢰하지 않는다. 관리 API는 src/admin과 별도 호스트로 분리한다. [관리자 구조](admin-api.md)를 참고한다. 정지 시 기존 세션을 폐기한다.

로그인 시 세션을 회전하고 30일 만료를 저장한다. 쿠키 HttpOnly·SameSite=Lax, APP_ENV=production에서는 Secure. 비밀번호 변경은 전체 세션을 폐기한다. 비밀번호는 무작위 salt와 scrypt 64바이트 해시이며 일정 시간 비교한다. 상태 변경은 POST, 동일 출처와 서명된 CSRF 값 둘 다 검사한다. 로그인 오류로 이메일 존재 여부를 구분하지 않는다.

OAuth는 Authorization Code+PKCE(S256), 10분 state/verifier 쿠키, 서버 토큰 교환, 검증된 이메일만 허용한다. 제공자 토큰은 저장하지 않는다. 기존 이메일과 충돌하면 명시적으로 거부한다. 신규 계정은 동의 화면을 거친다. 개발용 가짜 OAuth 계정이나 운영 메일 성공 우회는 없다.

## 콘텐츠와 운영 보안

Markdown을 marked로 처리한 후 sanitize-html로 허용 태그·속성·URL만 남긴다. 외부 추적 이미지와 임의 스크립트·이벤트 속성을 제거한다. 이미지 업로드는 로그인·CSRF·rate limit, 5MB 스트림 제한, png/jpeg/webp whitelist와 sharp 실제 디코딩·메타데이터 제거·1920px 제한·webp 재인코딩을 거친다. 서버가 임의 외부 URL을 대신 fetch하지 않는다.

요청 본문은 스트리밍 64KiB와 개별 필드 길이로 제한한다. IP는 날짜별 HMAC으로 요청 제한 키를 만들고 원문을 보관하지 않는다. TRUST_PROXY는 실제 앞단이 X-Forwarded-For를 덮어쓸 때만 활성화한다. CSP·nosniff·frame deny·referrer policy를 적용한다. CSP inline 허용은 현재 Astro/JSON-LD와 자체 theme 구성을 위한 제한이며, 업로드 HTML은 제공하지 않는다. HTML 캐시는 사용자별 private/no-store다.

내장 로그는 오류명과 경로만 기록하고 request body·provider token·메일 토큰을 출력하지 않는다. reverse proxy도 `/reset`, `/verify-email`, `/unsubscribe`, OAuth callback의 query·cookie를 로그에 남기지 않도록 구성한다. 탈퇴한 업로드의 물리 파일 및 과거 백업은 운영 보존 정책에 따라 별도 정리해야 한다. 공개 서비스 전 운영 주체와 보존 기간을 확정한다.

## 집계 정의

공개 합계(`/api/totals`)는 공개 SaaS 중 가이드가 있는 수(`guides`), 전체 공개 SaaS 수(`services`; 기본 도구와 회원 등록 포함), 공개된 제작 후기·작품 게시글 수(`builds`)다. 기본 항목은 활성 도구여야 하고 회원 항목은 등록자 계정이 활성이어야 한다. 비공개·검토 중·숨김·삭제된 콘텐츠는 각 공개 목록과 같은 기준으로 제외한다. 도구별 후기 수와 기본 정렬은 해당 도구에 연결된 공개 builds 글을 사용한다. 질문과 댓글은 후기 수에 포함하지 않는다.

기존 votes는 사용자 본인의 대체 경험 표시로만 유지한다. 익명 쿠키·계정별 중복과 로그인 시 병합 처리는 보존하되, 사람 수·제작 성공·금액 합계로 환산하지 않는다. `monthly`, `excluded` 합계와 숫자 롤링 UI는 제거했다. 가격은 도구의 요금 정보 및 가격 정렬에만 사용한다.

분석은 pageview/search/copy/vote/signup/post/share 이벤트 횟수만 받는다. 검색어·이메일·본문·세션은 보내지 않는다. 페이지 경로는 `/:slug`, `/community/[id]` 등 유형이며 공개 글의 개인 정보가 경로 집계에 들어가지 않는다. 봇을 완벽히 제외한 순방문자 통계는 아니다.

## 모바일 전용 화면 (2026-09-16)

760px 이하에서는 `MobileShell.astro`가 상단 탐색과 하단 4개 메뉴를 제공한다. 홈은 검색·공개 콘텐츠 수·분야 선택·도구 카드 순서로 구성하고, `MobileDirectory.astro`의 네이티브 dialog에서 필터를 모아 적용한다. 데스크톱 표와 모바일 카드는 같은 서버 데이터와 링크를 사용한다. 별도 모바일 도메인이나 기기별 리다이렉트가 없어 공유 URL·세션·검색 조건이 유지된다.

상세는 가능한 범위·제작 요청문·참고 정보로 구분한다. 모바일에서만 선택한 내용이 표시되며 URL 해시와 뒤로가기가 상태를 복원한다. 761px 이상으로 전환하면 전체 내용을 다시 표시한다. JS가 없으면 모든 상세 내용과 필터 폼을 읽고 사용할 수 있다. 폼·권한·API·DB는 기존 경로를 그대로 사용한다.

`src/styles/mobile.css`는 전용 화면의 크기·배치·터치 영역·safe-area를 관리한다. 글쓰기는 게시판·관련 도구를 먼저 선택하고, 내 활동은 저장·작성 기록을 프로필 설정보다 먼저 보여준다. 다크/라이트 테마는 공통 토큰을 사용한다.

## 공동 편집

등록 출처와 관계없이 회원이 공개 SaaS에 수정 제안을 남긴다. `service_edits`의 비공개 전후 스냅샷을 운영자가 검토하고 기준 revision이 일치할 때만 서비스와 가이드를 함께 반영한다. 상세 흐름과 이미지 권한은 [services.md](services.md)에 정리했다.
