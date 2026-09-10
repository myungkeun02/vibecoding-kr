# 요구사항 검토와 추적 · 2026-09-08

## 확인한 입력과 우선순위

현재 사용자의 한국판 확장 요청(공개 사본 `public/prompts/korean-rebuild.txt`)을 최우선으로 삼았다. 같은 프로젝트에 있던 `docs/superpowers/specs/2026-09-08-vibecoding-kr-design.md`와 `docs/superpowers/plans/2026-09-08-vibecoding-kr-phase1.md`를 대조했다. 초기 저장소에는 이 설계·실행 계획과 `.gitignore`가 있었고 실행 가능한 애플리케이션·기존 사용자 DB는 없었다. 적용할 별도 AGENTS.md는 발견되지 않았다. 원본 문서는 로컬에 보존했다. 공개 저장소에는 개인 대화 연결을 담은 기존 문서와 그 Git 이력을 옮기지 않고 이 검토서·최신 기획을 제공한다.

공식 서비스 `https://canivibecodeit.com`의 푸터 GitHub 링크를 통해 `canivibecodeit/canivibecodeit`를 확인했다. 확인 커밋 `8f2d20a31320d636c7bf9500bbbc0a6fef217280`, 기록 시각 2026-09-02T16:54:19Z, 저작자 Rob Hallam, 실제 LICENSE는 MIT다. 로컬 참고 사본에서 README·package·DB·상세 페이지 구조를 확인했다. 새 구현에 참고한 제품 구조와 요구사항의 관계를 공개 프롬프트에 남겼다. 원본의 현재 광고·유료 기능은 요청 범위에 포함하지 않았다.

## 유지·수정·가정

|기존 결정 또는 충돌|최종 결정과 이유|
|---|---|
|바이브코딩가능? 브랜드, 개발 도구 분위기|유지. 중앙 `src/lib/config.ts`에서 이름·설명·주소 관리|
|Astro server / Node / PostgreSQL / vanilla JS|2026-09-10 사용자 선택에 따라 PostgreSQL로 전환. 공식 최신 호환 문서를 확인해 Astro 7.3.1, Node adapter 11.1.5 선택|
|1단계 85~87개 SaaS 중심|121개 정식 도구·15개 카테고리, 설치형·무료·오픈소스·일회성 포함. 출처 실패 6개 비공개|
|No accounts, 계정·커뮤니티는 후속 단계|현재 요청에 따라 지금 구현. 로컬 계정·서버 세션 + 기존 제공자 Google/GitHub OAuth|
|Better Auth 예정|외부 공급자 없이 테스트 가능한 scrypt·서버 세션과 공식 OAuth 코드 흐름 구현. 불필요한 두 인증 체계 병행을 피하고 권한·토큰·동의를 통합|
|고정 USD×1,400, 모르는 가격도 수치화|확인한 기준일 환율로만 환산. null과 0 구분, 월·연·일회성 구분|
|단일 프롬프트로 SaaS 완전 대체 주장|개인·5명 이하 사용 사례와 손실 명시. 판정은 편집 의견이며 실제 제작 미실행 표시|
|투표 localStorage와 IP 제한 중심|서명된 익명 쿠키 + 회원 고유키, PostgreSQL 중복 제약·로그인 병합. UI의 테마만 localStorage|
|검색어 원문 저장·상위 검색어 공개|민감한 검색어 수집 금지에 따라 횟수만 집계. 인기 도구 순위는 실제 인증 기반|
|해시 필터와 전체 목록|query URL에 모든 상태를 보존하고 SSR 페이지 단위 결과로 점진적 갱신|
|자동 제안→봇 fork PR|접수·채택 DB와 검토된 JSON의 초안 PR 어댑터/CLI 구현. 미검증 AI 데이터를 자동 발행하지 않도록 출처·스키마 검증 필수|
|R2 이미지, Resend·주간 다이제스트, 카카오 공유|이번 범위에 구현. 로컬 이미지·메일로 내부 QA, 외부 계정 테스트는 고유 ID로 분리|
|원본과 현재의 수익화|No payments·외부 추적 없음 유지. 유료권한·광고·가짜수치 없음|
|실제 호스팅 연결 없음|영속 Node 서버용 설정과 로컬 production bundle 검증. 영속 디스크 없는 정적/Worker 호스트에 DB가 보존된다고 주장하지 않음|

되돌릴 수 있는 기본값: 도구 목록 20개/페이지, 커뮤니티 15개/페이지, 댓글 답글 1단계, 한국어 기본, 자체 일일 집계 90일, 공개 가입 후 이메일 미확인 계정도 글쓰기 가능. 외부 키 미제공 때문에 임의 계정·도메인·발신 주소를 만들어내지 않았다. 정책의 운영 주체·연락처는 배포자 입력 자리로 표시한다.

## 요구사항 → 구현 → 검증

아래 E 번호는 `docs/qa/report.md`의 브라우저 테스트 번호와 연결된다. 기능 구현과 실제 외부 성공 여부는 구분한다.

|ID / 요구|화면·API|구조|검증 및 상태|
|---|---|---|---|
|R01 입력·우선순위·연속 실행|이 문서, 최신 기획, QA 기록|원문 보존·공개 검토본|문서·원본 LICENSE 확인 PASS|
|R02 브랜드·다크/라이트·모바일|Base, global.css, client.ts|테마 저장·자체 폰트|E13·E16 PASS|
|R03 영속 스택·JSON·마이그레이션|전체 SSR, seed|tools / migrations / 영속 site.db|단위 동기화·실제 재시작·백업/복원 PASS|
|R04 실재 100+ / 12+ 도구|홈·카테고리·상세|121 공개 / 127 JSON / 15 category|validate·E01 PASS, 공식 가격 미확인 별도|
|R05 판정·고유 범위·프롬프트|상세·손실·FAQ·대안·3종 복사|AppSchema, promptVersion/history|E01·E03 PASS; 프롬프트 결과물 제작은 미실행 표시|
|R06 검색·필터·정렬·URL 복원|Directory / SSR URL|apps.ts·투표 순위|E02·E13 PASS|
|R07 티커·중복·환율·제외|Ticker·stats·POST vote|votes unique, totals, pricing.exchange|단위·E03·E06·E16 PASS|
|R08 가입·로그인·로그아웃·세션|signup/login/me, api auth|users/sessions/consents|E04·E10·E11·E14·E16 PASS|
|R09 이메일 확인·비번 재설정|verify-email/forgot/reset/me|해시 auth_tokens, 만료·일회성|로컬 outbox E10·E14 PASS; 실제 발송 EXT-MAIL|
|R10 소셜 로그인·계정 분리|auth/github·google/onboarding|identities·signed state·PKCE·동의|단위 provider 계약, E11 미설정 PASS; 실제 EXT-OAUTH-GH/GOOGLE|
|R11 프로필·내 활동·탈퇴|me/profile, api profile|FK cascade/익명화·soft delete|E04·E07·E11·E16 PASS|
|R12 커뮤니티 CRUD·반응|community/new/:id/edit, api posts/comments|posts/comments/reactions/bookmarks|E05·E07·E15 PASS|
|R13 이미지·외부 링크|PostEditor·api/upload·media|uploads·sharp 재인코딩·local/R2|E05·E11 PASS; 실제 R2 EXT-R2|
|R14 신고·알림·관리자|notifications/admin/suggest|reports/notifications/suggestions/audit|E08·E15 PASS|
|R15 JSON 검토·초안 PR·배포 구분|catalog:pr CLI + 관리자 상태|accepted_pending_release, GitHub fork adapter|단위 stub PASS; 실제 EXT-GH-PR|
|R16 waitlist·분석·철회|home/unsubscribe/stats|waitlist/analytics·honeypot|E09·E12 PASS|
|R17 주간 소식 발송|newsletter CLI 기본 미리보기|mail adapter/mail_deliveries 중복 방지|로컬 미리보기 PASS; 실제 EXT-DIGEST|
|R18 SEO·공유·원문|Base/sitemap/robots/OG/rebuild-prompt|SSR JSON-LD·122개 OG·글 공통 fallback|E01·E03, 한글 이미지 육안 PASS; 실제 Kakao EXT-KAKAO|
|R19 보안·실패 흐름|모든 변경 API·middleware|바인딩·권한·CSRF·request limit·안전한 Markdown|단위·E07·E10·E11·E12·E15 PASS|
|R20 공개·배포·복원|Docker·Compose·Railway·CI·문서|단일 Node + /data volume|로컬 production start PASS; 온라인 EXT-HOST, Docker BLOCKED_ACCESS|
|R21 수익화 없음·원본 권리 보존|LICENSE·footer·docs/licenses|MIT·독립 의존성 고지|소스·공개 대상 확인 PASS|

구현 완료는 외부 공급자 인증 성공, 실제 메일 도착, 라이선스 법률 검토 또는 개별 도구 제작 성공을 뜻하지 않는다. 해당 재검증 절차는 `docs/environment.md`에 있다.
