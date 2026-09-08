# 구조·데이터·권한·통계

## 요청과 실행

Astro server output + Node standalone adapter가 HTML을 렌더링한다. `src/middleware.ts`가 서명된 익명/CSRF 쿠키와 서버 세션을 읽고 보안 헤더·최소 이벤트를 처리한다. 주요 화면은 JS 없이 읽을 수 있고 가입 등 기본 폼 제출도 작동한다. `src/scripts/client.ts`가 검색 결과 갱신·클립보드·인증·반응·업로드를 점진적으로 추가한다.

프로덕션은 **Node 프로세스 1개 + 로컬 영속 디스크**다. better-sqlite3 WAL, foreign_keys, busy_timeout 5초, 짧은 트랜잭션과 바인딩을 사용한다. 파일 시스템을 공유하지 않는 수평 복제는 지원하지 않는다. 별도 DB로 바꾸기 전에는 replica를 늘리지 않는다.

## 편집 데이터와 런타임 데이터

`data/apps/<slug>.json` → `src/lib/schema.ts` 검사 → `src/lib/apps.ts` 공개 항목 로드 → `syncTools()` 메타데이터 UPSERT. 과거 도구는 active=0으로 남겨 글·투표 참조를 보존한다. runtime UPDATE가 원본 JSON을 바꾸지 않는다. 배포·재시작 때만 카탈로그를 다시 읽는다. 기존 plan의 샘플 JSON 생성 코드나 초기화 코드를 운영에서 실행하지 않는다.

`migrations/*.sql`은 정렬된 버전으로 1회씩 트랜잭션 적용한다. 현재 001 기본 테이블, 002 동의·인덱스, 003 이메일 확인 시각이다. 적용 기록이 있는 마이그레이션은 수정하지 않고 새 파일을 추가한다. seed는 계정·글·투표 초기화 없이 metadata만 동기화한다.

|테이블|책임·참조 정책|
|---|---|
|tools|slug 기본키, 기준 월 비용, 메타데이터 JSON, 활성 여부|
|users|이메일·닉네임 unique, salted scrypt, bio, role/status, email_verified_at|
|sessions / identities / consents|세션 토큰은 SHA-256 해시, 사용자 삭제 cascade, OAuth provider+subject unique, 동의 버전·시각|
|auth_tokens|이메일 확인/비밀번호 재설정용 해시·종류·만료. 30분·일회성|
|votes|slug+user / slug+anonymous 각각 unique; 계정 삭제 cascade|
|posts / comments|작성자 FK SET NULL, 상태로 숨김/삭제. 글 삭제 시 본문·제작 기록·하위 댓글 비움|
|reactions / bookmarks|사용자+글+종류, 사용자+도구 unique. 삭제 글의 반응 제거|
|notifications|사용자·글·댓글 참조, 읽음. 삭제 대상 알림 제거, 숨긴 대상 목록 제외|
|reports / suggestions / audit|신고 중복 제약, 제안 검토 상태, 관리자 조치 기록. 탈퇴 시 actor/user 참조 NULL|
|waitlist|이메일 unique, 동의 문구·시각, 임의 철회 토큰, 철회 상태|
|analytics / rate_limits|날짜·이벤트·경로 유형의 집계, 단기 요청 횟수|
|uploads|이미지 소유자·storage·크기·타입. 게시 전에는 소유자만 읽음|
|mail_deliveries|다이제스트 발송 시 생성, campaign+email unique|

SQL 실행은 `src/lib/db.ts`의 바인딩 헬퍼로 통일하되 기능별 SQL은 API에도 둔다. 이 크기의 서비스에서 다층 repository 추상화를 추가하지 않았다.

## 권한과 인증

비회원: 공개 페이지 읽기·검색·프롬프트 복사·익명 대체 인증·소식 구독. 회원: 글·댓글·반응·북마크·신고·제안·본인 정보 관리. 작성자만 글·댓글 수정·삭제. 관리자: 제한·숨김·복구·공지·신고·제안·감사. 매 요청마다 현재 users의 role/status를 읽어 권한 변경을 반영한다. 정지 시 기존 세션을 폐기한다.

로그인 시 세션을 회전하고 30일 만료를 저장한다. 쿠키 HttpOnly·SameSite=Lax, APP_ENV=production에서는 Secure. 비밀번호 변경은 전체 세션을 폐기한다. 비밀번호는 무작위 salt와 scrypt 64바이트 해시이며 일정 시간 비교한다. 상태 변경은 POST, 동일 출처와 서명된 CSRF 값 둘 다 검사한다. 로그인 오류로 이메일 존재 여부를 구분하지 않는다.

OAuth는 Authorization Code+PKCE(S256), 10분 state/verifier 쿠키, 서버 토큰 교환, 검증된 이메일만 허용한다. 제공자 토큰은 저장하지 않는다. 기존 이메일과 충돌하면 명시적으로 거부한다. 신규 계정은 동의 화면을 거친다. 개발용 가짜 OAuth 계정이나 운영 메일 성공 우회는 없다.

## 콘텐츠와 운영 보안

Markdown을 marked로 처리한 후 sanitize-html로 허용 태그·속성·URL만 남긴다. 외부 추적 이미지와 임의 스크립트·이벤트 속성을 제거한다. 이미지 업로드는 로그인·CSRF·rate limit, 5MB 스트림 제한, png/jpeg/webp whitelist와 sharp 실제 디코딩·메타데이터 제거·1920px 제한·webp 재인코딩을 거친다. 서버가 임의 외부 URL을 대신 fetch하지 않는다.

요청 본문은 스트리밍 64KiB와 개별 필드 길이로 제한한다. IP는 날짜별 HMAC으로 요청 제한 키를 만들고 원문을 보관하지 않는다. TRUST_PROXY는 실제 앞단이 X-Forwarded-For를 덮어쓸 때만 활성화한다. CSP·nosniff·frame deny·referrer policy를 적용한다. CSP inline 허용은 현재 Astro/JSON-LD와 자체 theme 구성을 위한 제한이며, 업로드 HTML은 제공하지 않는다. HTML 캐시는 사용자별 private/no-store다.

내장 로그는 오류명과 경로만 기록하고 request body·provider token·메일 토큰을 출력하지 않는다. reverse proxy도 `/reset`, `/verify-email`, `/unsubscribe`, OAuth callback의 query·cookie를 로그에 남기지 않도록 구성한다. 탈퇴한 업로드의 물리 파일 및 과거 백업은 운영 보존 정책에 따라 별도 정리해야 한다. 공개 서비스 전 운영 주체와 보존 기간을 확정한다.

## 집계 정의

`SUM(COALESCE(tools.price,0))`를 활성 도구와 유효 votes 조인으로 계산한다. 익명 쿠키에 따라 한 도구 1건, 계정에 따라 1건을 허용하고 로그인 시 같은 도구 중복을 제거한다. 철회는 DELETE로 반영된다. IP는 스팸 완화용이며 동일인 증명의 수단이 아니다.

priceMonthly는 검증된 기준 플랜·최소 좌석의 KRW 월 비용이다. 월 결제 원금이 있으면 우선하고 연 결제 월 환산만 확인된 경우 이를 명시한다. 무료 0원은 순위에 포함, 일회성·미확인·견적·사용량은 null로 금액 제외 건수를 분리한다. 메타데이터 가격 갱신은 현재 모든 인증의 추정액에 반영되며 역사적 절약액 시계열은 아니다.

분석은 pageview/search/copy/vote/signup/post/share 이벤트 횟수만 받는다. 검색어·이메일·본문·세션은 보내지 않는다. 페이지 경로는 `/:slug`, `/community/[id]` 등 유형이며 공개 글의 개인 정보가 경로 집계에 들어가지 않는다. 봇을 완벽히 제외한 순방문자 통계는 아니다.
