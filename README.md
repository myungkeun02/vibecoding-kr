# >_ 바이브코딩가능?

“내가 쓰는 기능만 직접 만들 수 있을까?”를 탐색하고 제작 경험을 나누는 한국어 서비스입니다. Astro SSR, Node, SQLite, vanilla JavaScript로 실제 계정·커뮤니티·대체 인증을 제공합니다. 결제나 광고는 없습니다.

현재 카탈로그는 **121개 공개 도구 / 15개 카테고리**입니다. 공식 페이지를 확인하지 못한 후보 6개는 공개 목록에서 제외했습니다. 가격·판정의 검증 수준은 서로 다르며 모든 제작 프롬프트는 **편집 검토** 상태입니다. 121개 결과물을 실제 제작했다는 뜻이 아닙니다.

## 시작하기

Node 22.14 이상(22 LTS 권장), pnpm 10.30.1이 필요합니다. Linux에서 native 모듈 빌드 시 Python 3, make, C++ 컴파일러가 필요할 수 있습니다.

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

[로컬 서비스](http://localhost:8095)에서 가입하고 글을 작성할 수 있습니다. `.env` 기본값은 로컬 전용입니다. 세션 키를 비워두면 `data/private/.session-secret`에 무작위 키를 생성하며, DB와 업로드는 `data/private`에 보존됩니다. Astro 7 개발 서버는 백그라운드로 실행됩니다. 종료는 `pnpm exec astro dev stop`, 로그는 `pnpm exec astro dev logs`입니다.

```sh
pnpm build
pnpm exec astro dev stop
pnpm start
```

`build`는 카탈로그 검증과 한글 OG 이미지 122장 생성을 포함합니다. `start`는 빌드된 Node 서버를 실행합니다. `.env`의 `APP_ENV=development`로 실행하면 로컬 쿠키와 메일 보관함을 사용합니다. 인터넷 운영에서는 반드시 `APP_ENV=production`, HTTPS 주소, 영속 절대 경로, 별도 세션 키를 설정하세요.

## 검증

```sh
pnpm env:check
pnpm validate
pnpm check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:persistence
pnpm test:production
```

E2E는 빌드된 서버를 8096 포트와 `data/test/e2e`에서 실행하고 해당 테스트 폴더만 초기화합니다. 재시작·복원 테스트는 8097 포트와 별도 새 테스트 폴더를 사용합니다. 8095의 사용자 데이터는 건드리지 않습니다. 실패 추적 파일과 테스트 DB는 공개 대상에서 제외합니다.

## 관리자와 콘텐츠 운영

1. 서비스에서 운영자 본인의 계정을 만듭니다.
2. 같은 DB 경로로 `pnpm admin 운영자이메일`을 실행합니다.
3. 다시 로그인하여 `/admin`에 접근합니다. 세션은 권한 부여 시 폐기됩니다.

카탈로그의 유일한 편집 원본은 `data/apps/<slug>.json`입니다. `pnpm validate && pnpm build`로 검사하고 재배포하면 메타데이터만 동기화되며 계정·글·투표는 유지됩니다. `pnpm seed`를 반복해도 초기화되지 않습니다. 숨긴 도구는 `published:false`로 처리하며 기존 참조는 DB에 남깁니다.

제안은 접수 → 관리자 채택(배포 대기) → JSON 출처 검토 → 초안 PR → CI·병합 → 재배포 순서입니다. 선택적인 `pnpm catalog:pr <제안ID> data/apps/<slug>.json --publish`는 설정된 봇 fork에서 초안 PR을 만들며, 운영 DB나 제안자의 이메일을 전송하지 않습니다. 자동 병합은 하지 않습니다.

## 문서

- [검토 결과와 요구사항 추적](docs/requirements-review.md)
- [최신 제품 기획](docs/product-spec.md)
- [구조·DB·권한·통계](docs/architecture.md)
- [카탈로그 출처·가격·판정](docs/catalog.md)
- [환경변수와 외부 연동 재검증](docs/environment.md)
- [배포·백업·복원·롤백](docs/deployment.md)
- [실제 QA 결과](docs/qa/report.md)
- [기여 안내](CONTRIBUTING.md)

현재 온라인 운영 배포는 완료되지 않았습니다. 로컬 production bundle 실행과 영속성은 검증했습니다. Node와 영속 볼륨을 제공하는 서버용 Dockerfile, Compose, Railway 설정을 포함합니다. 실제 외부 OAuth·메일·R2·카카오 공유는 운영 키를 등록한 뒤 [외부 검증 명세](docs/environment.md#외부-연동-재검증)에 따라 확인해야 합니다.

## 출처와 라이선스

공식 [Can I Vibecode It?](https://canivibecodeit.com)의 공개 링크로 확인한 [원본 저장소](https://github.com/canivibecodeit/canivibecodeit)를 참고했습니다. 원본 확인 커밋은 `8f2d20a31320d636c7bf9500bbbc0a6fef217280`입니다. 원본 MIT 저작권 고지는 [별도 사본](docs/licenses/ORIGINAL-MIT.txt)에 보존했습니다.

이 구현의 코드는 [MIT](LICENSE)입니다. 폰트·의존성·링크한 대체 도구의 라이선스는 각각 적용됩니다. [의존성 목록](docs/licenses/dependencies.json)은 그 라이선스를 대체하지 않습니다. 실제 재구축 요청과 원본 프롬프트는 [공개 사본](public/prompts/korean-rebuild.txt) 및 서비스 푸터에 있습니다.
