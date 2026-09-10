# 배포·영속 저장·백업·복원

## 현재 상태

2026-09-10 PostgreSQL 전환 후 로컬 Node production bundle과 실제 브라우저·재시작·백업/복원을 검증했다. Railway PostgreSQL과 웹 서비스·업로드 볼륨을 생성했으며 첫 배포를 검증 중이다. 실제 공개 URL 검증 전에는 온라인 운영 완료로 보고하지 않는다.

## Node 서버

작업 경로는 프로젝트 루트다. Node 22 LTS와 PostgreSQL 15 이상을 사용한다. `.env`에 DATABASE_URL, APP_ENV=production, SITE_URL의 실제 HTTPS origin, 영속 절대 DATA_DIR, 32자 이상 SESSION_SECRET, HOST=0.0.0.0, PORT를 설정한다. 비밀값은 다른 사용자에게 읽히지 않게 한다.

```sh
pnpm install --frozen-lockfile
pnpm env:check
pnpm build
pnpm start
```

시작 시 마이그레이션과 JSON→tools 동기화를 수행한다. 기존 DB를 삭제하는 pre-deploy seed를 실행하지 않는다. 프로세스 매니저나 systemd로 재시작 정책을 설정하고 한 인스턴스만 띄운다. HTTPS reverse proxy를 앞에 두고 X-Forwarded-For를 직접 덮어쓰는 구성에서만 TRUST_PROXY=1로 한다. health는 `/api/health`, 앱은 기본 8095다. 서버 health는 외부 메일/OAuth의 성공을 보장하지 않는다.

## Docker Compose

Dockerfile은 빌드 단계와 운영 단계를 분리한다. 시작 스크립트가 볼륨 소유권을 준비한 뒤 비루트 Node 사용자로 전환한다. 컨테이너 `/data`가 **named volume**에 연결되어 업로드를 보존한다. DB는 별도 PostgreSQL이며 DATABASE_URL로 연결한다. 비밀값·사용자 DB·업로드는 이미지에 포함하지 않는다. `.env`의 운영 값을 설정한다. Compose의 HOST/PORT/DATA_DIR/APP_ENV가 로컬 예제를 덮어쓴다.

```sh
docker compose config --quiet
docker compose build
docker compose up -d
docker compose logs --tail=50 app
```

호스트의 127.0.0.1:8095에만 바인딩한다. 같은 호스트의 HTTPS 프록시로 접속한다. Docker 예제에서는 `docker compose exec app node scripts/operations.mjs admin <운영자이메일>`로 관리자 권한을 부여한다. 반드시 해당 계정을 먼저 가입하고 부여 후 다시 로그인한다. `docker compose down -v`는 운영 데이터 볼륨을 지우므로 재배포 절차에 쓰지 않는다.

## Railway에 올리는 경우

Railway의 새 서비스는 기존 `railway.toml` 방식 대신 서비스 설정 또는 Infrastructure as Code로 관리한다. 이 배포는 서비스 설정에서 Builder=Dockerfile, Dockerfile Path=Dockerfile, Healthcheck Path=/api/health, Timeout=90초, Replica=1을 지정한다. Dockerfile의 VOLUME 선언은 Railway에서 지원하지 않으므로 사용하지 않고 실제 Railway 볼륨을 장착한다. 같은 프로젝트에 PostgreSQL과 웹 서비스를 만든다. 웹 서비스의 DATABASE_URL은 `${{Postgres.DATABASE_URL}}`로 내부 연결을 참조하고 DATABASE_POOL_MAX=5를 유지한다. 공개 GitHub 소스를 연결하고 **웹 서비스에 `/data` 볼륨을 먼저 장착**한다. `DATA_DIR=/data`, production 설정, 실제 도메인·OAuth callback을 등록한다. 볼륨 UID/GID가 컨테이너의 node(1000) 사용자에게 쓰기 가능한지 확인한다. 권한이 맞지 않으면 권한을 준비한 뒤 시작하며 임시 경로로 우회하지 않는다.

볼륨은 런타임에 장착되므로 DB 마이그레이션을 build 단계에 넣지 않는다. 배포 후 테스트 계정과 글·인증·이미지를 만들고 재배포하여 그대로 남는지 확인한다. 실제 서비스의 restart 테스트 전 별도 백업을 확보한다. [Railway 볼륨 공식 문서](https://docs.railway.com/volumes)와 [Dockerfile 공식 문서](https://docs.railway.com/builds/dockerfiles)를 2026-09-08 확인했다.

## 도메인·공유·외부 설정

SITE_URL 변경 후 재시작/재배포한다. `/sitemap.xml`, 상세 canonical, JSON-LD, X/Kakao 링크, 메일 주소가 새 HTTPS origin인지 확인한다. OG는 빌드된 `dist/client/og`에서 제공한다. 새 커뮤니티 글은 `/og/default.png`를 사용한다. 제목·설명은 해당 글별로 SSR한다. Google/GitHub 앱에는 새 callback URI를 별도로 등록한다.

실제 공개 운영 전 약관·개인정보의 운영 주체와 연락처를 입력한다. 비밀번호·쿠키·요청본문·OAuth code·확인/철회 토큰을 proxy 로그에 저장하지 않는다. 에러 로그는 상태·경로·오류 유형으로 제한한다.

## 백업

PostgreSQL의 `pg_dump`로 일관된 custom-format 백업을 만든다. 백업 위치는 새 절대 경로여야 하며 기존 파일을 덮어쓰지 않는다. pg_dump/pg_restore는 서버와 같은 메이저 버전 또는 더 최신 버전을 사용한다. Docker 이미지에는 PostgreSQL 18 클라이언트를 포함한다. 접속 자격은 명령 인수나 출력에 노출하지 않는다.

```sh
pnpm backup /secure-backup/site-20260910.dump
pnpm ops integrity
```

`DATA_DIR/uploads`와 운영 SESSION_SECRET도 별도로 안전하게 보관한다. R2를 사용한다면 객체 백업도 필요하다. DB와 파일 시점을 맞추려면 쓰기를 잠시 중지한다. 백업을 같은 Railway 볼륨에만 두지 말고 외부 암호화 보관소에도 저장한다. Railway의 PostgreSQL 템플릿은 DB를 실행해 주는 방식이므로 별도 백업 일정을 설정하고 복원 연습을 수행한다.

## 복원

1. 웹 서버와 같은 DB에 쓰는 작업을 모두 중지한다.
2. DATABASE_URL과 DATABASE_SCHEMA가 복원할 DB·스키마를 가리키는지 확인한다. 백업과 같은 스키마 이름을 사용한다.
3. `pnpm restore /secure-backup/site-20260910.dump --server-stopped`를 실행한다.
4. 같은 시점의 uploads를 복원한다.
5. `pnpm ops integrity` 후 서버를 시작하고 계정·글·이미지를 확인한다.

복원기는 먼저 현재 DB를 `before-restore` 사본으로 백업하고, pg_restore를 단일 트랜잭션으로 실행한다. 복원시점 이후 변경은 별도 백업에만 남으므로 쓰기를 중지한 상태에서 수행한다. `pnpm test:persistence`는 전용 PostgreSQL 스키마에서 실제 서버 재시작과 백업·복원을 검증한다.

## 기존 SQLite에서 전환

1. 이전 Node 앱과 SQLite 쓰기를 중지한다. SQLite backup API로 일관된 별도 사본을 만든다.
2. 빈 PostgreSQL을 준비하고 DATABASE_URL을 설정한다. 새 앱은 아직 시작하지 않는다.
3. `pnpm db:import /secure-backup/site.db --apply`를 실행한다.
4. 전환기는 전체 테이블의 값·행 수·관계를 비교하고 식별자 시퀀스를 보정한다. 대상에 데이터가 있으면 덮어쓰지 않고 거부한다.
5. 기존 SESSION_SECRET과 uploads를 그대로 유지하고 새 앱을 시작한다. 카탈로그·계정·글·로그인 상태를 확인한다.

원본 SQLite 사본은 변경하지 않는다. better-sqlite3는 이 전환 도구와 시험용 데이터 생성에만 사용하는 개발 의존성이며 운영 웹앱은 PostgreSQL만 사용한다. PostgreSQL에서 새로 작성한 데이터는 옛 SQLite로 자동 복사되지 않으므로 이전 앱으로 돌아가기 전에 변경 기록을 보존해야 한다.

## 롤백·테스트 격리

이전 Git tag/commit으로 애플리케이션을 다시 빌드하되 영속 볼륨은 그대로 유지한다. 새 마이그레이션과 이전 코드의 호환 여부를 staging에서 먼저 확인한다. 비호환이면 앱과 DB를 함께 같은 시점으로 되돌려야 하며, 이후 사용자 입력을 잃을 수 있으므로 백업·변경 기록을 먼저 보존한다. 현재 마이그레이션은 추가 중심이며 자동 down migration은 없다.

DB 검사는 별도 TEST_DATABASE_URL에서 무작위 `qa_*` 스키마를 사용하며 해당 스키마만 정리한다. 업로드 E2E는 `data/test/e2e`, 재시작 테스트는 무작위 `data/test/restart-*`를 사용한다. `.env`, `data/private`, `data/test`, DB, 메일 outbox, 테스트 추적 파일을 저장소·이미지에 넣지 않는다. 테스트 정리는 이름과 대상이 확실한 격리 폴더에만 수행한다.

## 공개 소스 내보내기

로컬 원본 기획과 기존 Git 이력에 개인 대화 연결이 있어 보존용 로컬 이력과 공개 소스를 분리했다. `scripts/export-public.mjs <새-빈-디렉터리>`는 소스·JSON·문서·라이선스·테스트만 명시적으로 내보내고 사적 경로를 검사한다. 새 디렉터리에서 Git을 초기화하고 공개 repo에 push한다. 기존 비공개 저장소의 공개 전환은 하지 않는다. 후속 변경도 export 결과 diff를 검토하여 공개 저장소에 반영한다.
