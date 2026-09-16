# 관리자 콘솔 검증

## 범위

별도 관리자 호스트·Google 인증·API·화면을 추가했다. 일반 회원가입과 SaaS 등록은 유지한다. SaaS와 가이드 편집·검토, 회원 관리, 신고 대상 내용 확인과 숨김·복원, 공지, 관리자 권한, 운영 설정, 집계와 조치 기록을 제공한다.

`src/admin`에 관리 동작을 모으고 이전 공개 서비스의 관리자 mutation을 제거했다. 초기 관리자는 비공개 환경변수로 지정한다. Google의 검증된 이메일과 고정된 subject를 함께 확인하며 일반 서비스 세션과 역할 표시를 신뢰하지 않는다.

## 확인 방법

- Google OAuth 및 권한, 기본 기능 단위 테스트 44개 통과.
- 별도 공개/관리 Node 프로세스와 PostgreSQL 스키마에서 브라우저 UI·API를 검사. 초기 관리자 보호, 일반 관리자의 권한 변경 금지, 권한 회수 즉시 세션 무효화, CSRF, 위조 호스트, 공개 API 우회 차단 포함.
- 360·768·1440px에서 관리자 주요 화면의 가로 넘침과 마스코트 로딩을 확인. 390·1440px 화면은 screenshots/admin-*에 저장.
- 서버 재시작과 PostgreSQL 백업·복원 뒤 관리자 멤버·세션·조치 기록과 승인된 SaaS 수정 내용이 유지됨을 확인.
- 운영 모드의 Worker→Node 연결에서 HTML form과 multipart 이미지 첨부, 별도 세션과 비공개 이미지, Google callback 주소, Secure/HttpOnly/Domain 없는 OAuth 쿠키를 검사.
- 공개 페이지·회원가입·커뮤니티·SaaS 공동 편집의 기존 브라우저 회귀 검사를 함께 실행. 자세한 결과는 browser-summary.json과 admin-gateway-results.json에 기록.

## 배포 범위

현재 물리적인 서버·DB는 공유한다. 관리자 호스트는 Cloudflare Worker Custom Domain을 통해 연결하고, 비공개 gateway 키 외에 Google 관리자 세션과 서버 권한 검사를 계속 요구한다. 별도 서버/Tailscale 이전은 아직 하지 않았다. 해당 절차는 [관리자 API 문서](../admin-api.md)에 기록했다.

외부 Google Cloud 설정과 실제 최초 관리자 Google 로그인 완료 여부는 배포 후 별도로 확인한다. 테스트용 세션 생성은 격리 테스트 DB 안에서만 수행하며 운영 테스트 로그인 경로는 제공하지 않는다.
