# 도구 아이콘 출처

`public/icons/`의 도구 아이콘과 `scripts/icons/figjam.svg`는 각 제품·브랜드 소유자의 자산이다. 프로젝트 코드의 MIT 라이선스가 이 자산에 대한 권리를 부여하지 않는다. 목록에서 해당 도구를 식별하기 위해 사용하며 제휴·보증을 뜻하지 않는다.

`data/icons.json`에 각 파일의 공식 자산 주소, 확인한 페이지, 확인 날짜, 원본 크기와 파일 해시를 보존한다. 공식 홈페이지의 favicon·제품 아이콘을 우선하며, DaVinci Resolve는 Blackmagic Design이 배포하는 Apple App Store 제품 아이콘을 사용한다. FigJam은 공식 페이지의 제품 탐색 메뉴에 포함된 SVG다. 크기 조정·투명 여백·WebP 변환을 적용했고 로고를 새로 그리거나 글자를 바꾸지 않았다.

제품별 수동 출처는 `scripts/icons/overrides.json`에서 관리한다. Figma의 관련 안내는 [공식 브랜드 가이드](https://www.figma.com/using-the-figma-brand/)에서 확인할 수 있다. 각 브랜드의 이용 조건은 해당 권리자의 안내에 따른다.

## 갱신

```sh
pnpm icons:fetch                         # 신규 공개 도구의 아이콘만 확보
pnpm icons:fetch --only=microsoft-excel  # 선택한 제품 다시 확인
pnpm icons:fetch --refresh              # 전체 출처 다시 확인
pnpm validate && pnpm build
```

가져오기는 편집자가 실행하는 명령이다. 빌드·서버 요청·사용자 브라우저에서 외부 아이콘 수집 서비스를 호출하지 않는다. 가져온 파일은 직접 확인한 후 manifest와 함께 커밋한다. 출처 확인 실패는 기존 파일을 유지하며, 파일이 없는 신규 도구와 브라우저 로딩 실패에는 도구명의 첫 글자를 표시한다. 수동 출처 실패는 `PRODUCT_OVERRIDE_FAILED`로 출력되므로 회사 공통 아이콘으로 바뀌지 않았는지 확인한다. 내려받은 조사용 HTML은 공개하지 않는 `data/private/icon-research`에 보관한다.
