# 주황색 UI와 로봇 캐릭터

2026-09-16 사용자 요청: 더 간결한 UI, 주황색 포인트, 얇은 선, 살짝 둥근 모서리. Android 캐릭터를 연상시키는 로봇에 반짝이는 반달눈과 BloodTrail 같은 장난스러운 이빨 웃음.

## 화면 규칙

- 밝은 모드: 따뜻한 흰색 배경, 주황색 `#c4521c`, 가는 중성 테두리.
- 어두운 모드: 차콜 배경, 주황색 `#ffa264`, 가는 갈색 계열 테두리.
- 일반 카드·입력·버튼 모서리 8px, 필터 창 윗모서리 12px.
- 카드마다 반복되던 안내 문구와 안쪽 구분선, 메뉴 선택 상태의 두꺼운 장식을 제거.
- 주요 메뉴 아이콘 선 1.4px, 카드 테두리 1px. 키보드 포커스는 알아보기 쉽게 유지.
- 기존 모바일 전용 메뉴·필터·상세 전환, 데스크톱 배치와 계정 기능은 유지.

## 캐릭터 파일

내장 ImageGen으로 한 장을 생성했다. 외부 원본 이미지를 사용하지 않았고, 투명 배경 PNG 원본을 보존했다. 브라우저용 크기와 형식만 변환했다.

| 용도 | 파일 |
| --- | --- |
| 투명 원본, 1254×1254 | `public/brand/vibepan-robot.png` |
| 미리보기, 256×256 | `public/brand/vibepan-robot-256.png` |
| 사이트 로고, 128×128 WebP | `public/brand/vibepan-robot-128.webp` |
| 파비콘, 32×32 | `public/favicon-32.png` |
| 다중 크기 파비콘, 16·32·48px | `public/favicon.ico` |
| Apple 터치 아이콘, 180×180 | `public/apple-touch-icon.png` |

## 생성 프롬프트 전문

```text
Use case: logo-brand
Asset type: ONE square standalone transparent PNG mascot head for a Korean tech/community website, also usable as a 16–32 px favicon.
Primary request: An original compact friendly robot head with Android-character-like charm, sparkling happy upward crescent eyes, and a mischievous cheeky broad toothy grin with the expressive energy of a BloodTrail emote, with no blood or gore.
Scene/backdrop: Actual fully transparent alpha background. No solid background, no checkerboard drawn into the image.
Subject: Warm tangerine orange robot head only. Two short antennae. Gentle dome/squircle silhouette with modest rounding. Dark brown happy upward crescent eyes, with tiny ivory glints integrated into the eyes. Broad off-white toothy grin showing just 3–4 simple squared teeth, playful and slightly cheeky.
Style/medium: Clean flat vector-like raster graphic. Thin delicate dark brown facial detailing, no chunky outlines.
Composition/framing: One centered head occupying approximately 85% of the square canvas, with enough space to retain both antennae. Large simple unmistakable face, clear silhouette at favicon size.
Color palette: Warm tangerine orange, dark brown details, ivory/off-white teeth and tiny eye glints.
Constraints: Generate exactly ONE image, one original standalone head, no body, no other characters, no text, no letters, no watermark, no frame, no border, no mockup. No gradients, shadows, 3D, texture, blood or gore. Preserve genuine background transparency.
```

## 서비스 안에서의 활용

- `BrandMark`: 기존 상단·하단 로고와 파비콘.
- `BrandIntro`: 로그인·회원가입·소셜 가입 마무리·비밀번호 재설정·수신 거부, 내 활동·대체 현황·도구 제안의 안내 머리말.
- `EmptyState`: 도구 검색·커뮤니티의 빈 결과, 저장한 도구·알림·공개 프로필·도구별 제작 이야기의 빈 상태.
- `Mascot`: 홈의 제작 범위 안내, 업데이트 소식, 도구·게시글·분야·일반 404 안내.
- 구조화 데이터의 서비스 로고와 공개 저장소 소개에도 같은 캐릭터를 사용한다.

캐릭터 크기는 48·64·88px이며, 모바일 머리말에서는 56px로 표시한다. 문구가 역할을 설명하므로 캐릭터는 빈 `alt`와 `aria-hidden`을 사용한다. 도구별 공식 아이콘과 사용자 콘텐츠에는 캐릭터를 덮어씌우지 않는다. 반복 목록 항목마다 장식을 넣지 않으며 움직임도 추가하지 않는다.

고해상도 화면용 `public/brand/vibepan-robot-256.webp`는 기존 생성 원본의 크기·형식만 변환한 파일이다. `Mascot`의 `srcset`으로 128px/256px 자산을 선택한다.
