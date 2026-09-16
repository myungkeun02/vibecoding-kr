# 관리자 운영 화면과 API

관리자 주소는 `https://admin.vibepan.com`이다. 일반 서비스의 회원가입·SaaS 등록·수정 제안은 유지하며, 관리 화면에서 전체 내용을 처리한다.

## 기능

- SaaS·제작 가이드 직접 추가와 수정, 회원 등록 검토, 수정 전·후 비교 및 승인·보완 요청, 공개 중지와 재공개.
- 회원 검색, 이메일 확인 상태 조회, 계정 직접 생성, 이용 제한·해제, 서비스 로그인 세션 종료.
- 게시글·댓글 숨김과 복원, 게시글 상단 고정, 공지 작성, 신고 처리, 기존 콘텐츠 제안 검토.
- 7·30·90일 페이지 열람·회원가입·SaaS 등록·게시글 추이, 프롬프트 복사, 공개 SaaS 분야와 제작 후기 집계.
- 최초 관리자의 추가 관리자 지정·권한 회수, 가입·등록의 임시 중지, 관리자 조치 기록 조회.

숫자는 실제 PostgreSQL 레코드에서 집계한다. 열람 수는 요청 횟수이며 방문자 수가 아니다. 관리자 화면 요청은 제외한다. 집계는 UTC이며, 계정·콘텐츠 집계는 현재 보존된 데이터 기준이다. 제작 후기 수를 검증된 대체 성공 수로 표시하지 않는다.

## 인증 및 권한

1. `ADMIN_BOOTSTRAP_EMAIL`을 비공개 배포 환경에서 지정한다. 최초 실행 시 owner 행 하나만 만든다. 환경변수를 바꿔도 기존 owner를 자동 교체하지 않는다.
2. 해당 Google 계정의 실제 인증을 마쳐야 세션이 생긴다. OAuth authorization code + PKCE, 브라우저 쿠키와 연결된 일회용 state를 검증하고 Google userinfo의 확인된 이메일만 허용한다.
3. 첫 로그인 후 Google subject를 고정한다. 동일 이메일이라도 다른 subject는 거절한다. 가입 전 계정이라면 일반 서비스 계정도 연결하되 `users.role`은 관리자 권한을 부여하는 수단이 아니다.
4. 관리자는 별도 `admin_members`, `admin_sessions`를 사용한다. 일반 세션·이메일 비밀번호·기존 `users.role=admin`만으로 접근할 수 없다.
5. 운영 쿠키는 `__Host-vibepan-admin`, Secure / HttpOnly / SameSite=Lax / Path=/ / Domain 없음. 세션 원문은 DB에 보관하지 않고 SHA-256 해시만 저장하며 8시간 후 만료한다.
6. 모든 변경 API는 관리자 상태·세션, 정확한 관리자 Origin, 세션별 CSRF 토큰을 검사한다. 본문·업로드 크기와 호출 빈도를 제한한다. 권한 회수 시 세션을 삭제하고 처리 중 요청도 트랜잭션에서 재검사한다.
7. 추가 관리자는 콘텐츠·회원·커뮤니티 운영을 할 수 있다. **owner만 관리자 권한 부여·회수와 가입·등록 설정을 변경**한다. owner의 화면상 삭제·권한 이전은 제공하지 않는다. Google 인증 설정 변경 권한과 서비스 관리 권한은 별개다.

Google OAuth 클라이언트에 `https://admin.vibepan.com/api/admin/auth/callback`을 추가한다. 기존 서비스 콜백은 그대로 유지한다. 관리자 전용 OAuth 클라이언트가 필요하면 `ADMIN_GOOGLE_CLIENT_ID/SECRET`을 설정한다. Google 동의 화면이 Testing인 경우 허용된 테스트 사용자 설정도 필요하다. [Google OAuth 문서](https://developers.google.com/identity/protocols/oauth2/web-server)

## API 계약

관리자 호스트의 `/api/admin/v1` 하위에만 제공한다. 일반 서비스 호스트에서는 404이다. 인증 전 API는 401, 권한·Origin·CSRF 오류는 403, 유효하지 않은 입력은 400, 중복·수정 충돌은 409를 반환한다. POST는 JSON 또는 HTML form을 받으며 CSRF는 `x-csrf-token` 또는 form의 `csrf`로 전달한다. JSON 성공 응답은 `{ok:true, redirect, id?}`이고 실패 응답은 `{ok:false,error}`이다. HTML form 성공 시 303으로 이동한다.

| 메서드·경로 | 내용 | 권한 |
| --- | --- | --- |
| GET `/api/admin/auth/google` | Google 로그인 시작 | 공개 로그인 진입 |
| GET `/api/admin/auth/callback` | 일회용 OAuth 코드 검증 | Google state·브라우저 검증 |
| GET `/me` | 로그인한 관리자·역할·CSRF | 관리자 |
| GET `/overview?days=7\|30\|90` | 운영·분석 집계 | 관리자 |
| GET `/services`, `/service-edits`, `/users`, `/posts`, `/comments`, `/reports`, `/suggestions`, `/audit` | 검색·상태·페이지 목록 | 관리자 |
| GET `/services/:id` | SaaS·가이드 상세 | 관리자 |
| GET `/media/:id` | 검토 전 첨부 이미지 | 관리자 |
| GET `/admins`, `/settings` | 관리자 목록·운영 설정 조회 | 관리자 |
| POST `/services`, `/services/:id` | 추가·직접 수정. 기존 수정은 `revision` 필수 | 관리자 |
| POST `/services/:id/review` | `operation=publish\|reject\|hide`, `revision`, `note` | 관리자 |
| POST `/service-edits/:id/review` | `operation=accept\|reject`, `note` | 관리자 |
| POST `/uploads` | multipart `file`; PNG·JPEG·WebP 최대 5MB | 관리자 |
| POST `/users` | `email`, `nickname`, `password`로 일반 계정 생성 | 관리자 |
| POST `/users/:id/status` | `status=active\|suspended` | 관리자, 활성 관리자 계정 제한 불가 |
| POST `/users/:id/sessions` | 해당 회원의 서비스 로그인 세션 종료 | 관리자 |
| POST `/notices` | `title`, `body`로 공지 작성 | 관리자 |
| POST `/posts/:id/moderate` | `operation=hide\|restore\|pin\|unpin` | 관리자 |
| POST `/comments/:id/moderate` | `operation=hide\|restore` | 관리자 |
| POST `/reports/:id/moderate` | `operation=resolve\|dismiss` | 관리자 |
| POST `/suggestions/:id/moderate` | `operation=accept\|reject`; 승인 후 별도 콘텐츠 배포 필요 | 관리자 |
| POST `/admins` | `email`의 Google 계정에 일반 관리자 권한 지정 | owner |
| POST `/admins/:id/revoke` | 권한 회수와 관리자 세션 종료 | owner |
| POST `/settings` | `registration_open`, `saas_submissions_open` 모두 boolean | owner |
| POST `/logout` | 현재 관리자 세션 종료 | 관리자 |

목록은 `q`, `status`, `page`를 지원하며 페이지당 20개이다. 게시글은 `board` 필터도 지원한다. 사용자 비밀번호·토큰은 조회 응답·조치 기록에 포함하지 않는다. SaaS 저장 데이터는 일반 등록과 같은 검증을 사용하고 `publication=published|pending|hidden`을 명시할 수 있다. 업로드는 재인코딩하며 외부 URL을 서버에서 임의로 가져오지 않는다. 로그에는 작업 종류·대상·필요한 검토 안내만 남긴다.

## 분리 구조와 배포

- `src/admin/`: 관리자 인증·조회·관리 동작·API·클라이언트.
- `src/pages/api/admin/`: 얇은 관리자 라우트.
- `src/pages/admin/`, `src/layouts/admin/`, `src/styles/admin.css`: 별도 관리 UI.
- `src/lib/`: DB·이미지 저장·SaaS 유효성 등 공통 기반. 일반 서비스 라우트는 관리자 관리 동작을 호출하지 않는다.
- `migrations/postgres/004-admin-console.sql`: 관리자 멤버·세션·OAuth state·조치 기록·운영 설정.

현재는 같은 Railway 프로세스와 DB를 쓰되 호스트·세션·API를 분리한다. Railway 도메인 제한 때문에 `infra/admin-gateway`의 Cloudflare Worker Custom Domain으로 관리자 호스트를 연결한다. Worker는 관리자 요청을 기존 origin으로 전달하고 서버 간 비밀 키와 고정된 관리자 호스트 헤더를 추가한다. 원래 경로를 유지하되 목적지 origin은 고정한다. origin은 키가 있는 요청만 관리자 표면으로 처리한다. 이 키는 Google 세션 인증을 대체하지 않는다. 사용자 입력의 forwarded-host나 동일 이름 헤더는 신뢰하지 않는다. assets 요청에는 키를 보내지 않는다. [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

Worker 배포: 해당 폴더에서 `wrangler deploy` 후 `wrangler secret put ADMIN_PROXY_SECRET`. 같은 키를 Railway 비공개 환경변수에 설정하고 `ADMIN_SITE_URL`, `ADMIN_BOOTSTRAP_EMAIL`, `APP_SURFACE=combined`를 설정한다. 키는 Git에 넣지 않는다. production DB를 백업한 뒤 새 마이그레이션을 배포한다.

향후 별도 서버로 옮길 때:

1. 공개 서비스는 `APP_SURFACE=public`로 두어 관리자 경로·gateway 요청을 모두 거절한다.
2. 별도 인스턴스는 `APP_SURFACE=admin`, 별도 포트·세션 환경과 DB 연결을 사용한다. 필요 시 관리자 DB 역할의 권한도 별도로 줄인다.
3. 내부 서버를 loopback에 바인딩하고 Tailscale Serve + tailnet ACL로 운영자 기기만 허용한다. public Cloudflare Worker·공개 ingress를 제거한다. Tailscale Funnel은 사용하지 않는다.
4. 새 관리자 URL과 Google OAuth callback을 함께 변경한다. 브라우저가 tailnet에 연결되어 있어야 로그인 완료 주소에 접근할 수 있다. Google 로그인과 관리자 권한 검사도 계속 적용한다.

Tailscale 연결과 별도 서버 이전은 이 구현에서 수행하지 않는다. [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)

## 검증

단위 테스트는 Google 미확인 이메일·미허용 이메일, state 만료·재사용·브라우저 불일치, Google subject 고정, 최초 관리자 보호, 권한 회수와 gateway 헤더를 검증한다. 브라우저 테스트는 별도 공개/관리 프로세스와 격리 PostgreSQL에서 실제 UI·API를 호출한다. 테스트 세션은 해당 테스트 DB 안에서만 만들며 운영용 테스트 로그인 경로는 없다. 재시작·백업 복원 테스트는 관리자 멤버·세션·조치 기록과 승인된 공동 편집 내용의 보존을 확인한다.
