# 배포·영속 저장·백업·복원

## 현재 상태

로컬 Node production bundle을 빌드·실행하고 실제 브라우저·재시작·백업/복원을 검증했다. 공개 인터넷 운영 배포는 하지 않았다. 사용할 수 있는 영속 Node 호스팅 계정이 없고 로컬 Docker 엔진도 실행되지 않았다. Worker/정적 호스트에 SQLite 파일을 임시 저장해 영속 배포라고 보고하지 않는다.

## Node 서버

작업 경로는 프로젝트 루트다. native better-sqlite3가 설치된 Node 22 LTS, 단일 프로세스를 사용한다. `.env`에 APP_ENV=production, SITE_URL의 실제 HTTPS origin, 영속 절대 DATA_DIR, 32자 이상 SESSION_SECRET, HOST=0.0.0.0, PORT를 설정한다. 비밀값은 다른 사용자에게 읽히지 않게 한다.

```sh
pnpm install --frozen-lockfile
pnpm env:check
pnpm build
pnpm start
```

시작 시 마이그레이션과 JSON→tools 동기화를 수행한다. 기존 DB를 삭제하는 pre-deploy seed를 실행하지 않는다. 프로세스 매니저나 systemd로 재시작 정책을 설정하고 한 인스턴스만 띄운다. HTTPS reverse proxy를 앞에 두고 X-Forwarded-For를 직접 덮어쓰는 구성에서만 TRUST_PROXY=1로 한다. health는 `/api/health`, 앱은 기본 8095다. 서버 health는 외부 메일/OAuth의 성공을 보장하지 않는다.

## Docker Compose

Dockerfile은 native 라이브러리를 빌드하는 단계와 비루트 Node 실행 단계를 분리한다. 컨테이너 `/data`가 **named volume**에 연결되며 DB·업로드를 이미지에 포함하지 않는다. `.env`의 운영 값을 설정한다. Compose의 HOST/PORT/DATA_DIR/APP_ENV가 로컬 예제를 덮어쓴다.

```sh
docker compose config --quiet
docker compose build
docker compose up -d
docker compose logs --tail=50 app
```

호스트의 127.0.0.1:8095에만 바인딩한다. 같은 호스트의 HTTPS 프록시로 접속한다. Docker 예제에서는 `docker compose exec app node scripts/operations.mjs admin <운영자이메일>`로 관리자 권한을 부여한다. 반드시 해당 계정을 먼저 가입하고 부여 후 다시 로그인한다. `docker compose down -v`는 운영 데이터 볼륨을 지우므로 재배포 절차에 쓰지 않는다.

## Railway에 올리는 경우

`railway.toml`은 Dockerfile 빌드, `/api/health`, 단일 replica를 지정한다. 공개 GitHub 소스를 연결하고 **서비스에 `/data` 볼륨을 먼저 장착**한다. `DATA_DIR=/data`, production 설정, 실제 도메인·OAuth callback을 등록한다. 볼륨 UID/GID가 컨테이너의 node(1000) 사용자에게 쓰기 가능한지 확인한다. 권한이 맞지 않으면 권한을 준비한 뒤 시작하며 임시 경로로 우회하지 않는다.

볼륨은 런타임에 장착되므로 DB 마이그레이션을 build 단계에 넣지 않는다. 배포 후 테스트 계정과 글·인증·이미지를 만들고 재배포하여 그대로 남는지 확인한다. 실제 서비스의 restart 테스트 전 별도 백업을 확보한다. [Railway 볼륨 공식 문서](https://docs.railway.com/volumes)와 [Dockerfile 공식 문서](https://docs.railway.com/builds/dockerfiles)를 2026-09-08 확인했다.

## 도메인·공유·외부 설정

SITE_URL 변경 후 재시작/재배포한다. `/sitemap.xml`, 상세 canonical, JSON-LD, X/Kakao 링크, 메일 주소가 새 HTTPS origin인지 확인한다. OG는 빌드된 `dist/client/og`에서 제공한다. 새 커뮤니티 글은 `/og/default.png`를 사용한다. 제목·설명은 해당 글별로 SSR한다. Google/GitHub 앱에는 새 callback URI를 별도로 등록한다.

실제 공개 운영 전 약관·개인정보의 운영 주체와 연락처를 입력한다. 비밀번호·쿠키·요청본문·OAuth code·확인/철회 토큰을 proxy 로그에 저장하지 않는다. 에러 로그는 상태·경로·오류 유형으로 제한한다.

## 백업

실행 중 DB 파일만 단순 복사하지 않는다. SQLite backup API를 사용한다. 백업 위치는 새 절대 경로여야 하며 기존 파일을 덮어쓰지 않는다.

```sh
pnpm backup /secure-backup/site-20260908.db
pnpm ops integrity
```

DB와 같은 시점의 `DATA_DIR/uploads`와 `.session-secret`(로컬만), 운영에서 별도 관리하는 SESSION_SECRET을 안전한 저장소에 보관한다. 게시·업로드를 잠시 중지하면 파일과 DB 시점을 맞추기 쉽다. R2 사용 시 bucket의 별도 백업·수명주기 정책이 필요하다. 암호화된 외부 보관과 주기적 복원 연습은 운영자의 절차다.

컨테이너에서는 `docker compose exec app node scripts/operations.mjs backup /data/backup-20260908.db` 후 `docker compose cp app:/data/backup-20260908.db <안전한호스트경로>`로 외부 보관한다. 백업을 같은 볼륨에만 두면 디스크 손실에 대비한 백업이 아니다.

## 복원

1. **서버를 중지**하고 같은 DB에 쓰는 프로세스가 없는지 확인한다.
2. `.env` DATA_DIR가 복원 대상의 절대 경로인지 확인한다.
3. `pnpm restore /secure-backup/site-20260908.db --server-stopped`를 실행한다.
4. 같은 시점의 uploads를 복원한다. R2이면 그 시점의 객체를 복원한다.
5. `pnpm ops integrity` 후 서버를 시작한다. 계정·글·인증·이미지를 확인한다.

복원기는 원본 backup integrity를 검사하고, 기존 DB를 checkpoint한 뒤 before-restore 사본을 만든다. WAL/SHM은 중지 상태에서만 정리한다. 이미 파괴된 데이터는 복원시점 이후로 되살아나지 않는다. `pnpm test:persistence`는 별도 테스트 DB에서 서버 재시작과 백업/복원을 재현한다.

Compose 복원은 `docker compose stop app` → 동일 볼륨으로 `docker compose run --rm --no-deps app node scripts/operations.mjs restore /data/backup-20260908.db --server-stopped` → uploads 복원 → `docker compose up -d` 순서다. 운영 중 복원 명령을 호출하지 않는다.

## 롤백·테스트 격리

이전 Git tag/commit으로 애플리케이션을 다시 빌드하되 영속 볼륨은 그대로 유지한다. 새 마이그레이션과 이전 코드의 호환 여부를 staging에서 먼저 확인한다. 비호환이면 앱과 DB를 함께 같은 시점으로 되돌려야 하며, 이후 사용자 입력을 잃을 수 있으므로 백업·변경 기록을 먼저 보존한다. 현재 마이그레이션은 추가 중심이며 자동 down migration은 없다.

E2E는 `data/test/e2e`, 재시작 테스트는 무작위 `data/test/restart-*`를 사용한다. `.env`, `data/private`, `data/test`, DB, 메일 outbox, 테스트 추적 파일을 저장소·이미지에 넣지 않는다. 테스트 정리는 이름과 대상이 확실한 격리 폴더에만 수행한다.

## 공개 소스 내보내기

로컬 원본 기획과 기존 Git 이력에 개인 대화 연결이 있어 보존용 로컬 이력과 공개 소스를 분리했다. `scripts/export-public.mjs <새-빈-디렉터리>`는 소스·JSON·문서·라이선스·테스트만 명시적으로 내보내고 사적 경로를 검사한다. 새 디렉터리에서 Git을 초기화하고 공개 repo에 push한다. 기존 비공개 저장소의 공개 전환은 하지 않는다. 후속 변경도 export 결과 diff를 검토하여 공개 저장소에 반영한다.
