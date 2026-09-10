# 환경변수 · 외부 연동 검증

비밀값은 `.env` 또는 호스팅 환경변수에만 저장한다. 예제에는 실키가 없다. `pnpm env:check`는 준비 여부만 출력하고 키를 출력하지 않는다. 모든 서버 변수 변경 후 서버를 재시작한다. SITE_URL은 SSR canonical·공유·sitemap·OAuth callback에 사용하므로 전체 빌드/재배포 후 옛 주소가 남지 않았는지 확인한다.

## A. 로컬에서 준비할 수 있는 값

|정확한 이름|용도 / 읽는 코드|공개 여부·예시|미설정 / 확인 방법|
|---|---|---|---|
|SITE_URL|`src/lib/config.ts`·absolute 링크|공개, `http://localhost:8095`|로컬 기본값. `/sitemap.xml`·canonical 확인|
|DATABASE_URL|db·PostgreSQL 접속|비밀, `postgresql://user:password@host:5432/db`|로컬·운영 모두 필수. 미설정 시 DB 연결 거부|
|DATABASE_POOL_MAX|pg 최대 연결 수|서버, `5`|작은 서비스는 기본 5개 유지|
|TEST_DATABASE_URL|자동 검사 전용 PostgreSQL|비밀, 운영과 다른 DB|검사마다 무작위 스키마 생성·정리. 운영 주소로 대체하지 않음|
|DATA_DIR|config·mail·storage|서버 전용, `data/private`|기본 경로 생성. 외부 계정 불필요. 재시작 테스트|
|SESSION_SECRET|config·security|비밀, 무작위 48바이트 hex|로컬은 DATA_DIR/.session-secret 생성, 운영은 자동값 허용 안 함. 파일 권한 600|
|HOST|Node adapter, 개발 명령은 loopback 지정|서버, `127.0.0.1`|로컬은 .env.example대로. 컨테이너는 `0.0.0.0`|
|PORT|Node adapter|서버, `8095`|예제대로 지정. 테스트는 8096/8097|
|APP_ENV|config·cookie·mail|서버, `development` / `production`|로컬 정책. 공개 운영에서 production 필수|

`.env.example`를 복사하고 준비한 PostgreSQL의 DATABASE_URL을 설정한다. 테스트에는 별도의 TEST_DATABASE_URL을 설정한다. .env를 출력하거나 session secret 값을 문서에 붙이지 않는다. 안전한 새 운영 키를 파일로 생성하려면 `node -e "require('fs').writeFileSync('session-secret.txt',require('crypto').randomBytes(48).toString('hex'),{mode:384})"`로 만든 뒤 호스팅의 비밀값 입력 기능으로 옮기고 파일을 제거한다. 이 파일도 커밋하지 않는다.

## B. 운영 필수값

|이름|운영 설정·미설정 동작|설정 후 확인|
|---|---|---|
|DATABASE_URL|Railway PostgreSQL 서비스의 내부 DATABASE_URL 참조|DB 연결·마이그레이션·health 확인|
|APP_ENV|`production` 필수. 개발용 outbox와 비보안 쿠키 사용 방지|`pnpm env:check`의 mode|
|SITE_URL|실제 HTTPS origin. 로컬 주소 금지|HTTPS 아니면 부팅 거부. canonical·sitemap·공유·메일 링크|
|DATA_DIR|실제 영속 볼륨의 절대 경로 `/data`|상대 경로면 운영 부팅 거부. 호스팅 볼륨 장착과 재시작 전후 레코드 확인|
|SESSION_SECRET|직접 만든 32자 이상 비밀값, 재배포 시 동일 유지|누락/짧으면 부팅 거부. 교체 시 기존 세션·익명 서명 무효화|
|HOST / PORT|`0.0.0.0` / 플랫폼 할당값. 예제 8095|healthcheck·앞단 프록시 연결|
|TRUST_PROXY|`src/pages/api/[...action].ts`, 업로드 API. 기본 `0`|신뢰하는 앞단이 X-Forwarded-For를 덮어쓰는 경우만 `1`. 임의 헤더로 rate limit 우회되지 않는지 확인|

## C. 선택적 외부 연동

로컬 OAuth 앱에 `http://localhost:4321/api/auth/callback/github`와 `http://localhost:4321/api/auth/callback/google`을 등록했다면 비공개 `.env`의 `SITE_URL=http://localhost:4321`, `PORT=4321`을 함께 설정한다. 개발 서버와 빌드한 서버 모두 이 포트를 사용한다. 기본 예제 포트는 8095다. 공급자 설정과 접속 주소의 호스트·포트·경로를 맞추며 `localhost`와 `127.0.0.1`을 섞지 않는다. 이전 `/auth/:provider/callback` 경로도 처리하지만 새 인증 요청은 `/api/auth/callback/:provider`를 사용한다.

각 행의 변수들은 모두 런타임에서 읽으므로 설정 후 재시작한다. OAuth client ID와 카카오 JavaScript 키는 공개 식별자이며 나머지 secret/token은 서버 전용이다. 부분 입력이면 관련 기능만 비활성화하거나 공급자 오류를 반환한다.

|변수명|기능 / 읽는 코드|발급·설정 / 형식·callback|미설정 동작·확인|
|---|---|---|---|
|GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET|GitHub 로그인 / `src/lib/oauth.ts`, `src/pages/auth/[...path].ts`|GitHub Settings → Developer settings → OAuth Apps. callback `SITE_URL/api/auth/callback/github`. 홈페이지는 SITE_URL. ID/secret 문자열|로그인 버튼 비활성·직접 호출 503. 로컬용 OAuth 앱과 운영용 분리. EXT-OAUTH-GH|
|GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET|Google 로그인 / 같은 파일|Google Cloud → Google Auth Platform → OAuth client Web application. redirect `SITE_URL/api/auth/callback/google`, scope openid email profile. ID `….apps.googleusercontent.com`|로그인 버튼 비활성·503. 테스트 사용자를 consent screen에 추가. EXT-OAUTH-GOOGLE|
|SMTP_URL|확인·재설정·뉴스레터 / `src/lib/mail.ts`|메일 공급자의 SMTP 자격, `smtps://user:password@host:465` (값 내 특수문자 URL 인코딩)|MAIL_FROM과 함께 사용. Resend가 있으면 Resend 우선. 로컬 outbox, 운영 발송 503. EXT-MAIL|
|RESEND_API_KEY|같은 기능·파일|Resend API Keys, 발신 도메인 검증. 비밀 문자열|MAIL_FROM 필요. 로컬 outbox와 실제 전송 상태를 구분. EXT-MAIL|
|MAIL_FROM|발신자 / mail.ts|검증된 발신 주소, `서비스 이름 <sender@your-domain>`|공급자 키만 있고 발신자가 없으면 외부 메일 비활성|
|R2_ENDPOINT|이미지 / `src/lib/storage.ts`|Cloudflare R2 S3 endpoint, `https://<account>.r2.cloudflarestorage.com`|네 가지 R2 변수가 모두 있어야 R2 사용. 나머지는 DATA_DIR/uploads 로컬 저장|
|R2_BUCKET|같은 기능|비공개 bucket 이름|브라우저 공개 bucket 불필요. `/media/:id` 서버 권한 확인 후 제공. EXT-R2|
|R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY|같은 기능|해당 bucket에 한정한 object read/write API 자격|서버 전용, 재배포 전후 기존 업로드 경로 유지. EXT-R2|
|KAKAO_JAVASCRIPT_KEY|카카오톡 공유 / `[slug].astro`, `client.ts`|Kakao Developers 앱 → JavaScript 키·Web 플랫폼 등록. SITE_URL 도메인 허용|키 없으면 버튼 숨김. 클릭한 경우에만 공식 SDK 2.8.3 로드. REST/admin 키를 넣지 않음. EXT-KAKAO|
|GITHUB_REPOSITORY|카탈로그 PR / `src/lib/catalog-pr.ts`|공개 대상 `owner/repo`|봇 fork와 token 포함 세 값 없으면 발행 거부|
|GITHUB_BOT_FORK|같은 기능|별도 계정의 실제 fork `bot/repo`|대상과 같은 repo는 거부. fork가 실제로 존재해야 함. EXT-GH-PR|
|GITHUB_BOT_TOKEN|같은 기능|봇의 최소 권한 토큰: fork Contents write, 대상 Pull requests write|값은 CLI/서버 전용, --publish 명시 시에만 외부 변경|

## 외부 연동 재검증

공통 시작: 테스트용 외부 계정·별도 DB/도메인을 준비 → 해당 변수 등록 → `pnpm env:check` → `pnpm build && pnpm start`. 운영 모드에서는 HTTPS를 통해 접근한다. 실제 개인 SNS 게시나 실제 구독자 일괄 발송은 QA에 포함하지 않는다. 공급자 stub 통과를 실제 성공으로 바꾸지 않는다. 2026-09-10 로컬 OAuth는 비공개 자격 설정과 양쪽 공급자의 로그인 화면 도착까지 확인했다. 실제 계정의 인증·동의와 가입 완료는 아직 미검증이며, 다른 외부 연동은 환경 준비가 필요하다.

|ID / 보류 이유|준비·실행·브라우저 순서|기대 결과|정리|
|---|---|---|---|
|EXT-OAUTH-GH / 실제 계정 인증 미검증|GitHub ID/secret와 callback 설정. `/login` → GitHub → 테스트 계정 동의 → `/onboarding` 약관·닉네임 → 원래 페이지. 로그아웃 후 재로그인. 동의 취소·state 변조·기존 로컬 이메일 충돌도 시도|새 identity 1개, 동의 기록·검증 이메일·세션; 기존 계정 자동 병합 없음; 거부는 정상 오류|테스트 계정 탈퇴, GitHub 승인 철회, 테스트 OAuth 앱 자격 폐기|
|EXT-OAUTH-GOOGLE / 실제 계정 인증 미검증|Google client와 테스트 사용자 설정. GitHub와 같은 흐름을 Google 버튼으로 수행|검증된 email만 사용, 동의 이전 users 생성 없음, 중복 subject 방지|테스트 계정 탈퇴, Google 연결 제거|
|EXT-MAIL / 발송 키·통제 수신함 없음|SMTP+MAIL_FROM 또는 Resend+MAIL_FROM, `/me` 확인 메일 요청 → 실제 수신함 → 확인 버튼. `/forgot` → 실제 재설정 링크 → 새 비밀번호 로그인. 만료·재사용도 확인|실제 받은 한국어 메일·정확한 HTTPS 링크, 확인 전 verified=null, 확인 후 기록, reset 후 세션 폐기. 발송 장애는 성공으로 표시하지 않음|통제 계정 탈퇴, 메일 삭제, 테스트 발송 키 회수|
|EXT-R2 / bucket 자격 없음|R2 네 값 설정, 회원으로 `/community/new` → png 업로드 → 글 게시 → 로그아웃 후 공개 이미지 → 서버 재시작 후 재확인. 미게시 파일 타 계정 접근 시도|bucket webp 객체, 공개 글 이미지 정상, 미게시 파일 404, invalid SVG/초과 크기 거부|테스트 글·계정 삭제, 테스트 bucket 객체와 로컬 테스트 DB 정리|
|EXT-KAKAO / 앱 키·허용 도메인 없음|키·Web 플랫폼 도메인 설정 → 도구 상세 카카오 버튼 → 공유 대상 선택 화면까지만 확인하고 취소|도구명·판정 설명·해당 OG·canonical URL 일치; 네트워크/CSP 오류 없음|SNS에 게시하지 않고 선택창 닫기, 테스트 앱 키 제거|
|EXT-GH-PR / 봇 fork·토큰 없음|테스트 fork/대상/키, 테스트 제안 관리자 채택 → 공식 출처와 JSON 편집 → `pnpm catalog:pr ID data/apps/slug.json` → 검증된 내용으로 `--publish`|봇 fork의 branch와 **draft** PR, CI 실행, 제안 상태는 배포 대기 유지. 개인정보 미포함|테스트 PR 닫고 branch 삭제, 테스트 데이터·토큰 제거|
|EXT-DIGEST / 발송 설정·통제 구독자 없음|별도 테스트 DB에 통제 주소만 구독, 최근 공개 글 작성. `pnpm newsletter` 미리보기 검토 → `pnpm newsletter --send --campaign=qa-YYYYMMDD` → 같은 campaign 재실행|수신 메일에 한국어 글 링크·철회 링크, 첫 발송만 기록·재실행 중복 0. 철회 후 다음 캠페인 제외|통제 수신함·계정·전용 DB·캠페인 정리|
|EXT-HOST / 실제 배포·영속 볼륨·HTTPS 검증 필요|`docs/deployment.md`대로 실제 Node+볼륨+도메인. health → 가입 → 글·업로드·인증 → 재배포 → 로그인/이미지/집계 → backup/restore 별도 staging|Secure 쿠키·HTTPS·canonical·실제 영속 레코드·한글 OG. 상용 임시 디스크를 성공으로 보지 않음|staging 계정·DB·볼륨만 정리; 운영 DB는 보존|

Docker 엔진은 로컬에서 실행되지 않아 이미지 빌드/컨테이너 시작은 **BLOCKED_ACCESS**다. `docker compose config --quiet`로 설정 문법을 확인한 후 실제 엔진에서 `docker compose build && docker compose up -d`와 EXT-HOST 흐름을 수행한다. 이는 Node production bundle의 로컬 검증 결과와 별개다.

공식 근거: [GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [Google OAuth 웹 서버](https://developers.google.com/identity/protocols/oauth2/web-server), [카카오 SDK 다운로드](https://developers.kakao.com/docs/ko/javascript/download), [카카오 공유](https://developers.kakao.com/docs/ko/kakaotalk-share/js-link).
