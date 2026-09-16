# 비밀키 관리 제안

2026-09-16 기준 제안이며, 아직 Infisical 계정 생성·연동·키 이전은 수행하지 않았다. 현재 운영 비밀값은 Railway 환경변수, 로컬 개발 비밀값은 Git에서 제외한 `.env`에 있다.

## 작은 규모에서 시작하기

오픈소스 기반 Infisical의 무료 클라우드 플랜을 우선 권장한다. 개발·운영 환경을 구분해 키를 보관하고 공식 Railway Secret Sync로 운영 앱에 전달할 수 있다. 현재 Free는 5개 identity(사람·머신 합계), 환경 3개, Secret Sync 10개를 제공한다. 감사 로그·비밀값 버전 관리·자동 교체는 무료 기능으로 가정하지 않는다. 요금과 기능은 도입 시 다시 확인한다.

직접 설치하는 방식은 Infisical 외에 PostgreSQL·Redis의 운영, 업데이트, 백업도 필요하므로 현재 단일 앱 운영에는 부담이 크다. 핵심 오픈소스와 별도 기업용 기능의 라이선스 범위도 구분한다.

## 도입 시 적용할 구성

- 프로젝트 `vibepan`, 환경 `dev`와 `prod`를 분리한다. 로컬 주소는 `http://localhost:4321`, 운영 주소는 연결 검증 후 `https://vibepan.com`을 사용한다.
- 앱 키는 `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`을 관리한다. 메일·스토리지 키는 실제 연동할 때 추가한다.
- 운영 `SESSION_SECRET`은 기존 값을 보존한다. 임의 변경으로 기존 로그인 세션을 끊지 않는다.
- Railway가 관리하는 DB 연결은 `${{Postgres.DATABASE_URL}}` 참조를 유지한다. `PORT`, `DATA_DIR` 등 호스팅 설정도 앱 키 동기화와 구분한다.
- 최초 동기화는 기존 Railway 변수를 보존하는 방식으로 설정한다. 전체 덮어쓰기는 사용하지 않으며, 관리 대상 키 범위를 제한하고 Secret Deletion을 비활성화한다. 적용 전 예상 변경 목록을 확인한다.
- 동기화 성공 후 새 환경변수를 적용하는 배포를 실행하고 health와 실제 로그인을 확인한다. 저장소·빌드 로그·검증 보고서에는 비밀값을 출력하지 않는다.
- 대화에 입력했던 OAuth 비밀키는 공급자에서 새로 발급해 이전하고, 새 키로 로그인 성공을 확인한 뒤 기존 키를 폐기한다. 공개 클라이언트 ID와 비밀키를 구분한다.

## 공식 자료

- [Infisical 요금·기능](https://infisical.com/pricing)
- [Railway Secret Sync와 기존 변수 보존 옵션](https://infisical.com/docs/integrations/secret-syncs/railway)
- [직접 설치 운영 안내](https://infisical.com/docs/self-hosting/overview)
- [라이선스](https://github.com/Infisical/infisical/blob/main/LICENSE)
- [Railway 환경변수](https://docs.railway.com/variables)
