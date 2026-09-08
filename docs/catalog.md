# 카탈로그 조사·가격·판정 기준

확인일: **2026-09-08**. 정식 공개 121개, 출처 확인 실패 후보 6개, 15개 카테고리. 제품별 JSON의 `sources`, `pricing.source`, `checkedOn`, `history`가 원본이다.

## 확인 수준

- `sources.status=verified`: 공식 제품 페이지가 응답하고 제품명과 안내를 확인했다는 의미다. 제공 기능 전부와 유료 플랜 전부의 실사용 검증이 아니다. 공식 사이트 HTML 확인 기록은 `docs/source-evidence.json`에 있다.
- 가격의 `verified`는 표시한 특정 플랜의 근거를 확인한 경우다. 그 외는 금액 null·확인 필요이며 `docs/pricing-evidence.json`의 확인 자료와 구분한다.
- `verification=editorial`: 모든 도구의 대체 판정과 프롬프트는 범위·손실을 편집 검토했다. 개별 도구 121개를 실행·제작해 검증하지 않았다. 웹서비스 QA 통과와 혼동하지 않는다.
- priorArt는 확인 가능한 저장소·LICENSE 링크를 둔다. 라이선스 API가 NOASSERTION이거나 복합·비표준인 경우 확인 필요로 표시한다. 확인 기록은 `docs/prior-art-evidence.json`이다. 링크한 제품의 코드를 이 사이트 MIT로 재라이선스하지 않는다.

## 이름과 후보 처리

Coda는 공식 공지에 따라 **Superhuman Docs**, Looker Studio는 **Google Data Studio**로 표시하고 옛 이름을 검색 별칭에 남겼다. slug는 기존 링크 안정성을 위해 유지한다. [Superhuman 공식 명칭 변경](https://help.superhuman.com/hc/en-us/articles/46210093285773-What-s-changing-Coda-becomes-Superhuman-Docs), [Google 공식 명칭 변경](https://cloud.google.com/blog/products/data-analytics/looker-studio-is-data-studio).

아래 후보는 공식 페이지를 정상 확인하지 못해 `published:false`다. 서비스가 폐업했다고 단정하지 않는다. 다른 공식 페이지·문서로 근거를 확인한 뒤 공개할 수 있다.

|후보|미확인 이유|
|---|---|
|네이버 캘린더|공식 페이지 검토 대기|
|Streamlabs Desktop|공식 페이지 검토 대기|
|카페24|공식 페이지 검토 대기|
|Excalidraw|공식 페이지 검토 대기|
|Vrew|공식 페이지 검토 대기|
|Canva|공식 페이지 검토 대기|

## 가격과 집계

외화 기준: 1 USD = **1,347.93 KRW**, 2026-09-07. [Frankfurter 실제 응답](https://api.frankfurter.dev/v1/2026-09-07?base=USD&symbols=KRW)을 `data/exchange.json`에 저장했다. 실시간 환율이나 카드 결제 환율이 아니다. 각 도구에도 기준일·출처를 보존한다. 소수 원은 도구별로 반올림하며 최소 좌석을 기준으로 한다. 세금·프로모션·환전 수수료·지역별 할인은 제외한다.

|도구 / 기준|실제 월 결제|연 결제 월 환산|일회성|티커 적용|
|---|---|---|---|---|
|Slack Pro, 1인 정가|USD 8.75|USD 7.25|해당 없음|11,794원/월|
|Trello Standard, 1인|USD 6|USD 5|해당 없음|8,088원/월|
|Linear Basic, 1인|확인 필요|USD 10|해당 없음|13,479원/월, 연 결제 기준 명시|
|UpNote Lifetime|다른 플랜|해당 없음|USD 39.99|월 합계 제외|
|Obsidian 본체|무료|무료|해당 없음|0원. 선택 Sync 서비스와 분리|

근거: [Slack](https://slack.com/intl/ko-kr/pricing), [Trello](https://trello.com/pricing), [Linear](https://linear.app/pricing), [UpNote](https://getupnote.com/), [Obsidian](https://obsidian.md/pricing). 일시적 프로모션을 정상 가격으로 쓰지 않았다. 나머지 유료 도구는 플랜별 실제 금액을 확인하기 전까지 null이다.

금액이 없는 도구를 무료처럼 표시하지 않는다. 무료 도구는 순위에 참여하지만 합계 0원, 일회성·사용량·견적·미확인은 제외 건수에 포함한다. 티커는 자기신고 추정치이고 실제 절약액·MRR 손실·순수익이 아니다.

## 공개 목록

|분류|개수|도구|
|---|---:|---|
|협업·메신저|8|Kakao Work, Discord, JANDI, NAVER WORKS, Slack, Google Chat, Microsoft Teams, Mattermost|
|노트·지식관리|10|Logseq, Joplin, Roam Research, Craft, Obsidian, UpNote, Microsoft OneNote, Notion, Evernote, Bear|
|오피스·문서|8|Google Sheets, 한컴오피스, Google Slides, Microsoft PowerPoint, Microsoft Excel, Microsoft Word, Google Docs, Polaris Office|
|프로젝트·할 일|11|Basecamp, monday.com, TickTick, Todoist, Asana, Jira, ClickUp, 플로우, Trello, Dooray!, Linear|
|데이터·대시보드|12|Metabase, Grist, Baserow, Smartsheet, Airtable, Tableau, NocoDB, Superhuman Docs, Redash, Google Data Studio, Rows, Microsoft Power BI|
|화이트보드·다이어그램|7|Miro, Lucidchart, tldraw, FigJam, diagrams.net, Whimsical, Figma|
|디자인·이미지|6|Adobe Illustrator, Photopea, 미리캔버스, Adobe Photoshop, Fotor, 망고보드|
|영상·오디오|8|CapCut, Adobe Premiere Pro, OBS Studio, Loom, Audacity, Descript, DaVinci Resolve, Adobe Audition|
|폼·설문|7|Tally, Microsoft Forms, Google Forms, Typeform, SurveyMonkey, Jotform, 네이버 폼|
|자동화·연동|7|n8n, Make, Power Automate, Activepieces, IFTTT, Pipedream, Zapier|
|고객관리·메일|9|Freshdesk, Channel Talk, Brevo, HubSpot, Intercom, Stibee, Zendesk, Salesforce, Mailchimp|
|일정·시간관리|7|Clockify, Calendly, Google Calendar, When2meet, Cal.com, Doodle, Toggl Track|
|파일·클라우드|7|pCloud, 네이버 MYBOX, Box, Google Drive, Synology Drive, Microsoft OneDrive, Dropbox|
|개발·API|6|GitLab, Insomnia, Bruno, Bitbucket, Postman, GitHub|
|웹사이트·노코드|8|Glide, WordPress, 식스샵, Wix, Webflow, Softr, Framer, 아임웹|

## 갱신 절차

공식 출처 확인 → 도구별 JSON 수정 → 출처·가격·환율·변경 이력 갱신 → `pnpm validate` → `pnpm build` → 전체 상세 렌더링 테스트 → PR 검토 → 재배포. 가격 페이지는 지역·로그인·시점에 따라 바뀔 수 있어 미확인 값을 추정으로 채우지 않는다. `scripts/verify-sources.mjs`는 조사 기록 수집 도구이며 그 성공만으로 새로운 가격이나 라이선스를 자동 검증하지 않는다.
