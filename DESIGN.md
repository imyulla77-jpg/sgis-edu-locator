# SGIS에듀 현행화 대상 찾기 — 설계 (DESIGN)

- 기능 이름(PDCA): `sgis-edu-refresh`
- 작성자: 최윤라
- 작성일: 2026-10-15 (2판. 1판 설계는 `trash-can/2026-10-15_이전버전_공통위치찾기/DESIGN.md`)
- 근거 문서: [PRD.md](PRD.md), [PLAN.md](PLAN.md), [CLAUDE.md](CLAUDE.md)
- PDCA 단계: **Design**

## 1. 전체 구조 한눈에

```
[담당자 브라우저: 화면]                         [Next.js 서버: app/api]                    [밖]
 시작 화면(주소·비밀번호) ──POST /api/targets──▶ 메인 3개·홈페이지 메뉴 읽기 ─────────▶ sgis.mods.go.kr
                         ◀── 대상 페이지 목록 ──  + 목록 데이터(JSON) 읽기
 진행률(수집)             ──POST /api/collect──▶ 상세 페이지 열기(1초 간격, 하나씩)
                         ◀── 그림·소제목·문장·   그림·문장·바로가기 읽기, 그림·연도 문장 캡처
                             바로가기·캡처
 진행률(AI 판단)          ──POST /api/judge───▶ 그림 받기 → 지문(sha256) → Claude API ─▶ api.anthropic.com
                         ◀── 최고 연도·판정       (같은 지문은 한 번만)
 결과 요약 → 엑셀 4개 시트 만들기(화면 안, exceljs) → 다운로드
```

- **서버에서만**: 브라우저 조종(playwright-core), SGIS 요청, Claude API 호출(`ANTHROPIC_API_KEY`), 실행 비밀번호 검사.
- **화면에서**: 진행 지휘(순서·쉬기·재시도), 같은 그림·문장 묶기, 시트 1~4 만들기, 다운로드. 결과는 화면 메모리에만 있고 저장하지 않는다(DB 없음).
- Vercel 한 번 실행 시간 제한 때문에 서버 일은 짧은 요청 여러 번으로 나눈다(1판 방식 유지).

## 2. 사이트 조사 결과 (2026-10-15, PLAN 작업 1·2)

### 2.1 검색 대상 페이지

| 구분 | 읽는 방법 | 결과 |
|---|---|---|
| 수업하기 3단계 | 각 과정 메인 상단 메뉴의 `classList?thema_id=…` 링크 이름을 PRD 4장 표와 띄어쓰기 무시 비교(똑같은 이름이 없으면 조사 "의"까지 무시 — 표 "우리나라의 인구변화" ↔ 사이트 "우리나라 인구변화") → 목록 데이터 `POST /ServiceAPI/edu/eduContentsList.json` (`thema_id`, `currentPageIndex`) | 초등 E01~E03 8개, 중학 M01~M04 12개, 고교 H01~H05 18개 = **38개 콘텐츠** |
| 주제보기 3단계 | 상단 메뉴 `issueList?issue_id=IS_0n` → `POST /ServiceAPI/edu/eduIssueContentsList.json` (`issue_id`, `currentPageIndex`) | 6개 주제에 38개 콘텐츠(수업하기와 **같은 38개**). 과정과 상관없이 같은 목록 |
| 스스로하기 3단계 (초등만) | 상단 메뉴 `myself/ppltnChange`, `myself/weatherChange` | 메뉴 자체가 내용 화면 2개(단계 탭 안에 그림) |

- 목록 데이터는 화면이 스스로 불러오는 공개 데이터(JSON)이며, 앱도 서버에서 같은 주소를 부른다. 3단계 메뉴 이름·번호는 매번 메인 상단 메뉴에서 읽고, 코드에 적어 두지 않는다.
- 상세 페이지 내용은 `classDetail`과 `issueDetail`이 같다(38개 모두 그림 목록 일치 확인). 그래서 **콘텐츠 하나는 한 번만 열고**(`/view/edu/{과정}/classDetail?contents_id=…`, 고교 콘텐츠는 `high`), 그 콘텐츠가 나오는 메뉴 위치를 모두 붙인다.
  - 예: `E0101`의 위치 = 초등>수업하기>인문환경과 인간생활, 초등·중학·고교>주제보기>인구와 고령화 (4곳)
- **실제로 여는 페이지: 콘텐츠 38개 + 스스로하기 2개 = 40개.** 1초 간격 + 페이지당 약 3초 → 수집 약 3분.

### 2.2 그림

- 상세 페이지 본문 그림: `/sgis_edu/resource/images/contents/body/…`(통계 그림)와 `/contents/sgis/…`(SGIS 화면 캡처) 186개 + 스스로하기 약 12개 ≈ **약 200개**.
- 뺄 것: `_thumb` 그림(목록 미리보기), 추천 콘텐츠 카드, 머리말·꼬리말, 장식 그림(`img_quiz01.png` 등 `/contents/` 밖 그림), `/upload/` 그림.
- 그림에 대체텍스트(alt)가 거의 없어 연도는 그림을 직접 봐야 한다 → Claude AI.

### 2.3 홈페이지 경로 (바로가기 버튼)

- 콘텐츠마다 바로가기 버튼이 1~2개 있다(38개 콘텐츠에 42개). 모양: `<button class="dirctBtn" onclick="window.open('/statbd/future_01.vw')">SGIS 분석지도(지방의 변화보기) 바로가기</button>`
- 버튼 문구에서 **메뉴**(통계주제도·대화형 통계지도·활용서비스·분석지도)와 **하위 이름**(괄호 안)을, `onclick`에서 **주소**를 읽는다. 문구의 `｢ ｣`, "대화형통계지도"처럼 띄어쓰기가 다른 표기는 정리해서 맞춘다.
- SGIS 홈페이지 메인(`https://sgis.mods.go.kr/`)의 상단 메뉴를 매번 읽어, 바로가기 주소가 4개 메뉴 중 어디 아래인지 **주소로** 확인한다. 상단 메뉴(`#gnb > ul > li`)에는 1단계 이름만 있고, 하위 메뉴는 같은 순서로 놓인 사이트맵(`.headerDiv .subMenu .inner > div > ul`)에 있다(2026-10-15 기준 4개 메뉴 하위 32개). 두 목록 개수가 다르면 경고하고 버튼 문구로만 정한다.
- 바로가기 주소 중 메뉴 목록과 똑같지 않은 것이 있다(예: `/jsp/pyramid/pyramid2.jsp` ↔ 메뉴 `/jsp/pyramid/pyramid1.jsp`, `/publicsmodel/newAging.vw` ↔ `/publicsmodel/`). 그래서 맞추는 순서는 ① 주소(물음표 앞) 똑같음 → ② 같은 폴더(마지막 `/` 앞) → ③ 버튼 문구(비고 "버튼 문구 기준")로 한다(구현 3에서 적용). 주소가 메뉴 목록에 없으면 버튼 문구로 정하고 비고에 "버튼 문구 기준"이라 적는다. 4개 메뉴가 아니면 "홈페이지 경로 없음".
- 소제목 영역 = 슬라이드(`.slideObj`, 넘겨 보는 화면 하나, 복제본 `.slick-cloned` 제외). 수업 상세·스스로하기 모두 이 구조다. 영역 이름은 "N번 화면: 소제목(최대 40자)".
- 그림과 버튼 짝짓기: **같은 슬라이드 안의 버튼만** 쓴다(버튼 1개 → 그 버튼, 그림 수와 버튼 수가 같으면 순서대로, 그 밖에는 "짝을 정할 수 없음"). 버튼이 없는 슬라이드의 그림은 "바로가기 버튼 없음" → 홈페이지 경로 없음.
  - 2026-10-15 바꿈: 처음엔 "콘텐츠 전체에 버튼이 1개면 모든 그림에 그 버튼"이었으나, 바로가기 버튼은 'SGIS에서 해 보기' 슬라이드(`contents/sgis/` 캡처 그림)에만 있고 본문 슬라이드의 그래프는 다른 화면이라 틀린 경로가 적히게 되어 바꿨다.
- 서버는 버튼(문구·주소)만 돌려주고, 홈페이지 경로는 `lib/home-link.ts`의 `resolveHomeLink`가 정한다(브라우저 없이 계산 → 화면에서 시트 만들 때 사용).

## 3. 결정 사항 (담당자 결정 2026-10-15)

| 항목 | 결정 |
|---|---|
| 연도 판단 | Claude AI가 그림을 보고 판단 |
| AI 모델 | **Claude Opus 5.5** (`claude-opus-5-5`) |
| 연결 패키지 | **`@anthropic-ai/sdk`** 설치 허락 (Implement 첫 작업에서 설치) |
| 홈페이지 경로 | 바로가기 버튼 주소로 |
| 수정 후 내용 | 앱은 수정 전만, 수정 후는 빈칸 |
| 1판 앱 | 새 요구사항으로 교체 |
| 배포본 보호 | **실행 비밀번호** (`RUN_PASSWORD`) |

## 4. AI 연도 판단 설계

- **요청 한 번 = 그림 한 장.** 서버가 그림을 받아(10초 제한) base64로 Claude에 보낸다. 같은 지문(파일 내용 sha256)의 그림은 화면이 한 번만 보낸다.
- 모델 `claude-opus-5-5`, `output_config.effort: "low"`(단순 판독이라 낮은 단계로 시간·요금을 줄임, 20개 대조에서 틀리면 `medium`으로 올림), `max_tokens` 4000. 구현: `lib/ai-judge.ts`의 `judgeImage`.
- 구조화 출력은 zod 패키지를 새로 설치하지 않도록 JSON 스키마를 직접 적어 `output_config.format: { type: "json_schema" }`로 보내고, 답 글자를 JSON으로 읽은 뒤 모양을 한 번 더 검사한다.
- 그림 종류(PNG·JPEG·GIF·WEBP)는 주소가 아니라 파일 첫 부분으로 정한다. 다른 주소로 넘겨주는 응답은 따라가지 않는다.
- **답 형식은 구조화 출력(`output_config.format`, JSON 스키마)** 으로 고정한다.

  ```json
  { "years": [1960, 1990, 2015], "maxYear": 2015, "status": "연도 있음" | "연도 없음" | "판독 불가" }
  ```

- 질문(요지): "이 그림에 글자로 적힌 4자리 연도(1900~2099)를 모두 찾아라. 범례·축·제목·출처 모두 포함. 확실히 읽히지 않으면 `판독 불가`."
- **판정은 코드가 한다**(AI에게 맡기지 않음): `maxYear ≤ 2026` → 현행화 대상, `≥ 2027` → 대상 아님, `연도 없음` → 대상 아님, `판독 불가`·오류·거절(`stop_reason: "refusal"`)·그림 못 받음 → 확인 필요. `years`에 없는 `maxYear`이거나 `maxYear`가 `years`의 최댓값과 다르면 확인 필요.
- 거절 대비로 SDK의 서버 측 대체 모델 기능(`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`)을 켠다. 대체 모델이 답한 경우 수집_기록 시트에 모델 이름을 함께 적는다.
- 오류 처리: SDK 기본 재시도(2번) 후에도 실패하면 확인 필요. `RateLimitError`면 화면이 5초 쉬고 1번 더 보낸다.
- **요금·시간 추정**: 그림 약 200개 × (입력 약 1,500 + 출력·생각 약 500 토큰) ≈ 입력 30만·출력 10만 토큰 → 한 번 검색에 **약 3~4달러**. 화면이 동시에 3개씩 보내면 AI 판단 약 10~15분.
  - 2026-10-15 실측(그림 8개): 그림 하나에 **2~5초**. 3개씩 보내면 약 200개에 약 3~5분으로 추정이 줄어든다(요금은 전체 실행 때 다시 잰다).
- **시험 결과(8개)**: 사람이 읽은 연도와 8개 모두 일치. 예) 인구 피라미드 "1960·2023·2072" → 최고 2072라 "대상 아님", SGIS 지도 캡처 "2010·2015·2020" → "현행화 대상", 연도가 없는 그림 3개 → "연도 없음".
- 키: `ANTHROPIC_API_KEY`(PC는 `.env`, 배포본은 Vercel 환경변수). 서버 코드 `lib/ai-judge.ts`에서만 SDK 기본 생성자(`new Anthropic()`)로 읽는다. 키·요청 내용은 로그에 남기지 않는다.

## 5. 주변 문장 설계

- 상세 페이지를 열 때(수집 단계) **그림이 있는 소제목 영역마다** 문장을 나눠(마침표·줄바꿈 기준) **1900~2026 사이 4자리 연도가 들어간 문장**만 고른다. 그림 판정 전이라 우선 모두 모아 두고, 화면이 판정 후 **현행화 대상 그림이 있는 영역의 문장만** 시트 1에 남긴다.
- 그 문장이 들어 있는 화면 요소(문단·목록 한 줄)를 서버 브라우저에서 캡처한다(너비 800픽셀 JPEG). 넘겨지지 않은 슬라이드는 화면에 안 보이므로, 그 요소를 부모 두 단계 모양과 함께 화면 맨 위에 복사해 찍는다. 페이지당 최대 40장, 못 찍으면 "캡처 불가".
- 그림 캡처는 페이지 안에서 그림을 캔버스에 줄여 그려 만든다(긴 변 최대 400픽셀 JPEG) — 슬라이드가 안 보여도 되고, 그림 줄이기 패키지가 필요 없다.
- 같은 영역에 그림이 여러 개면 "관련 그림" 칸에 그 영역 그림 번호를 모두 적는다.
- "2010년 이후"처럼 기간을 나타내는 연도도 찾되, 고칠지는 담당자가 정한다(수정 후 빈칸).

## 6. 데이터 모양 (`lib/refresh-types.ts`, PLAN 작업 5)

1판 화면이 화면 교체 전까지 계속 동작하도록 1판 `lib/types.ts`는 그대로 두고, 2판 타입은 새 파일 `lib/refresh-types.ts`에 둔다(실제 코드가 기준, 아래는 요약).

```ts
type Course = '초등' | '중학' | '고교';
type Verdict = '현행화 대상' | '대상 아님' | '연도 없음' | '확인 필요';

interface MenuLocation { course: Course; level2: '수업하기' | '스스로하기' | '주제보기'; level3: string; url: string }
interface PageTarget { contentsId: string | null; openUrl: string; title?: string; locations: MenuLocation[] }

interface HomeLink { menu: '통계주제도' | '대화형 통계지도' | '활용서비스' | '분석지도' | null; sub: string; url: string; note?: string }
interface DirectButton { text: string; url: string }
interface FoundImage { src: string; section: string; indexInSection: number; capture: string | null /* JPEG base64 */; button: DirectButton | null; buttonNote?: string }
interface YearSentence { section: string; text: string; capture: string | null /* JPEG base64 */; relatedImageSrcs: string[] }
interface PageResult { target: PageTarget; status: '성공' | '수집 실패' | '시간 초과'; error?: string; images: FoundImage[]; sentences: YearSentence[]; seconds: number }

interface Judgement { src: string; sha256: string | null; years: number[]; maxYear: number | null; verdict: Verdict; model: string | null; error?: string }
```

## 7. 서버 API

모든 API: `crossSiteResponse`로 다른 사이트 요청 막기 → **실행 비밀번호 검사** → 받은 주소 `isAllowedUrl` 재검사 → `tryAcquire`로 동시 실행 제한(넘으면 429).

| API | 받는 것 | 돌려주는 것 | 시간 한도 | 동시 실행 |
|---|---|---|---|---|
| `POST /api/targets` | `{ startUrl }` | `TargetList { pages: PageTarget[], homeMenus: HomeMenuItem[], warnings }` (시작·메인 3개·홈페이지 메인 열기, 목록 JSON 읽기 — 모두 1초 간격. 실측 약 48초) | 120초(안에서 100초 한도) | 브라우저 1 |
| `POST /api/refresh-collect` | `{ pages: PageTarget[] }` (최대 4개 — 캡처가 들어 있어 응답이 Vercel 한도 4.5MB를 넘지 않게) | `{ results: PageResult[] }` | 120초(안에서 100초 넘으면 남은 것은 "시간 초과") | 브라우저 1 |
| `POST /api/judge` | `{ src }` (`/sgis_edu/resource/images/contents/…`의 png·jpg·gif·webp만) | `Judgement` (그림 못 받음·AI 오류도 200 + "확인 필요") | 60초 | AI 3 (`JUDGE_SLOTS`) |

| 상태 코드 | 뜻 | 화면 처리 |
|---|---|---|
| 200 | 성공 | — |
| 400 | 주소·입력 잘못 | 안내문 |
| 401 | 비밀번호 틀림/없음 | 비밀번호 칸 다시 입력 |
| 403 | 다른 사이트에서 온 요청 | 안내문 |
| 429 | 다른 검색 진행 중 / AI 요청 많음 | 5초 쉬고 1번 더, 그래도면 안내 |
| 500 | 서버 오류(브라우저 없음 등) | 안내문, 해당 페이지·그림은 실패/확인 필요 |

- `app/api/image`(1판 그림 대신 받기)는 그림 캡처를 수집 때 서버 브라우저가 찍으므로(`FoundImage.capture`, 긴 변 최대 400픽셀 JPEG) 쓰지 않는다 → `trash-can/`.
- **실행 비밀번호**(`lib/run-password.ts`): 서버 환경변수 `RUN_PASSWORD`가 **있을 때만** 검사한다. 화면이 머리말 `x-run-password`로 보내고, 서버는 길이 같은지 + `crypto.timingSafeEqual`로 비교한다. PC(`.env`에 넣지 않음)에서는 검사하지 않고, 배포본(Vercel 환경변수)에서는 필수. 비밀번호는 화면 메모리에만 두고 저장하지 않는다.

## 8. 화면 흐름

1. **시작 화면**: 시작 주소(기본값 `https://sgis.mods.go.kr/view/edu/index`), 실행 비밀번호 칸(서버가 필요하다고 할 때만 보임), [검색 시작]. 안내문: "창을 닫으면 결과가 사라져요", "AI 사용 요금이 생겨요(한 번에 약 3~4달러)".
2. **진행 화면**: 단계 3개 표시 — ① 대상 찾기 ② 페이지 수집(n/40) ③ AI 판단(n/그림 수). 처음 3개 페이지 연속 실패면 멈추고 "사이트 접속 불가". 창 닫기 경고(`beforeunload`).
3. **결과 화면**: 요약 숫자(검색 페이지·실패, 그림 수, 현행화 대상·대상 아님·연도 없음·확인 필요, 수정 필요 문장 수, 홈페이지 경로 없음 수), [엑셀 다운로드], [다시 검색]. 실패·확인 필요가 있으면 다운로드 전 확인창.

## 9. 엑셀 (화면에서 exceljs로, `lib/excel.ts` 새로 씀)

공통: 머리글 굵게·고정, 캡처 칸은 행 높이를 그림에 맞춤, 3개 과정 모두에 나오는 그룹은 노란색 배경.

**시트 1 `현행화_기록`** — 행 = (현행화 대상·확인 필요 그림 또는 수정 필요 문장) × (메뉴 위치 1곳). 찾은 순서대로.

| 열 | 내용 |
|---|---|
| 순번 | 1부터 |
| 구분 | 그림 / 문장 |
| 캡처 | 그림: 수집 때 찍은 그림 캡처, 문장: 문장 캡처 (엑셀 칸에는 긴 변 160픽셀 크기로 표시) |
| 과정 · 2단계 · 3단계 | 예: 초등 · 주제보기 · 인구와 고령화 |
| 상세 페이지 제목 · 페이지 주소 | 메뉴 위치에 맞는 주소(수업하기는 `classDetail`, 주제보기는 `issueDetail`, 해당 과정 경로) |
| 소제목 · 그림 번호 | 예: 우리나라의 인구변화 · 2번째 그림 |
| 그림 파일 주소 | 그림 행만 |
| 최고 연도 · 판정 | 그림 행만 (예: 2015 · 현행화 대상) |
| 홈페이지 경로 · 홈페이지 주소 | 그림 행만 (예: 분석지도 > 지방의 변화보기 · https://sgis.mods.go.kr/statbd/future_01.vw) |
| 수정 전 내용 | 문장 행만 |
| 수정 후 내용 | **빈칸** (담당자 입력) |
| 관련 그림 | 문장 행만, 같은 영역 그림 파일 이름 |
| 비고 | 확인 필요 이유, "버튼 문구 기준" 등 |

**시트 2 `현행화_정렬`** — 시트 1의 모든 행을 그대로 옮기되 맨 앞에 `그룹ID` 열을 더하고, 정렬: 구분(그림 먼저) → 그룹ID → 과정(초등·중학·고교) → 2단계 → 3단계. 같은 그룹 경계에 굵은 위쪽 테두리.
- 그룹ID: 그림 = 파일 지문(sha256) 같음 → `IMG-001`…, 지문을 못 구한 그림은 주소별로 따로. 문장 = 띄어쓰기 정리 후 글자 같음 → `TXT-001`…. 번호는 처음 나온 순서대로.

**시트 3 `현행화_병합`** — 그룹 1개 = 1행.

| 열 | 내용 |
|---|---|
| 그룹ID · 구분 · 캡처 | |
| 최고 연도 · 판정 · 홈페이지 경로 · 홈페이지 주소 | 그림 그룹 (그룹 안에서 홈페이지 경로가 여러 개면 줄바꿈으로 모두) |
| 수정 전 내용 · 수정 후 내용(빈칸) | 문장 그룹 |
| 나온 곳 수 · 나온 과정 | 예: 4 · 초등·중학·고교 |
| 위치 목록 · 페이지 주소 목록 | 한 칸에 줄바꿈으로 모두 |

**시트 4 `수집_기록`** — 기준(검색 날짜, 시작 주소, 판정 기준 "최고 연도 2026년 이하", AI 모델, 그림 수·AI 호출 수), 페이지 목록(주소·상태·걸린 시간·오류), 확인 필요 그림 목록, 홈페이지 경로 없음 그림 목록.

- 파일 이름 `SGIS에듀_현행화대상_YYYY-MM-DD.xlsx`. 예상 크기: 그림 캡처 약 200행 × 30KB + 문장 캡처 약 150행 × 20KB ≈ **10MB 안팎**(50MB 한도 안).

## 10. 성공 기준 수치 확정 (PLAN SC-5)

| 항목 | 추정 | 목표 |
|---|---|---|
| 대상 찾기 | 약 30초 | — |
| 페이지 수집 40개 | 약 3분 → **실측 약 4분 40초**(캡처 포함, 2026-10-15) | — |
| AI 판단 약 200개(3개씩) | 약 10~15분 | — |
| 엑셀 만들기 | 약 30초 | — |
| **전체** | **약 15~20분** | **25분 이내** |
| 엑셀 크기 | 약 10MB | **50MB 이하** |
| AI 요금 | 약 3~4달러 | 한 번에 **5달러 이하** (넘으면 담당자에게 알림) |

## 11. 보안

- `ANTHROPIC_API_KEY`, `RUN_PASSWORD`는 서버 코드에서만 읽는다(`NEXT_PUBLIC_` 금지). 빌드 결과물 화면 쪽 파일(`.next/static`)에 두 이름이 없는지 확인한다(PLAN SC-6).
- `/api/judge`는 SGIS에듀 콘텐츠 그림 주소만 받아, 아무 그림이나 AI에 보내는 데 쓰이지 않게 한다.
- 결과 엑셀은 내부용. GitHub·인터넷에 올리지 않는다(`*.xlsx`는 `.gitignore`에 있음).
- `.env`가 Vercel 배포 파일에 섞여 올라가지 않도록 `.vercelignore`로 막았다(커밋 c2a2094).

## 12. 폴더 구조 (2판 목표)

```
app/
  page.tsx                 시작·진행·결과 화면 (고쳐 씀)
  api/targets/route.ts     (새) 대상 페이지 목록       ← api/menus 대체
  api/refresh-collect/route.ts (새) 상세 페이지 수집   ← 화면 교체 때 1판 api/collect는 trash-can으로
  api/judge/route.ts       (새) AI 연도 판단
components/
  StartForm.tsx            (고쳐 씀) 주소·비밀번호·검색 시작
  ProgressPanel.tsx        (고쳐 씀) 3단계 진행률
  ResultSummary.tsx        (고쳐 씀) 요약·다운로드
lib/
  refresh-types.ts         (새) 6장 타입  ← 화면 교체 때 1판 types.ts는 trash-can으로
  url.ts, site-check.ts, server-limit.ts, browser.ts   (살려 씀)
  run-password.ts          (새) 실행 비밀번호 검사
  targets.ts               (새) 메뉴 읽기·목록 JSON·홈페이지 메뉴     ← menus.ts 대체
  refresh-collect.ts       (새) 페이지 열기·재시도·시간 한도   ← 1판 collect.ts 대체
  refresh-extract.ts       (새) 그림·소제목·바로가기·연도 문장·캡처   ← 1판 extract.ts 대체
  home-link.ts             (새) 바로가기 → 홈페이지 경로
  ai-judge.ts              (새) Claude 호출·판정
  run-steps.ts             (고쳐 씀, ← run-batches.ts) 화면의 진행 지휘
  group.ts                 (새로 씀) 그룹ID 매기기
  excel.ts                 (새로 씀) 4개 시트
  download.ts              (고쳐 씀) 경고·파일 이름
scripts/
  run-dev.ts               (← collect-dev.ts) 화면 없이 전체 실행해 dev-output/에 저장
  check-sample.ts          (고쳐 씀) 무작위 20개 대조표 만들기
```

`trash-can/`으로 옮길 것(**화면을 2판으로 바꾸는 6번 작업 때 한꺼번에** — 그 전에 옮기면 1판 화면이 빌드되지 않아 배포본이 멈춘다): `lib/types.ts`, `lib/collect.ts`, `lib/extract.ts`, `app/api/collect`, `app/api/image`, `app/api/menus`, `lib/menus.ts`, `lib/menu-select.ts`, `lib/search.ts`, `lib/compare.ts`, `lib/past-result.ts`, `lib/thumbnail.ts`, `lib/collect-client.ts`(→ run-steps로 합침), `components/MenuPicker.tsx`, `components/PastCompare.tsx`, `components/ResultSearch.tsx`.

## 13. 구현 순서 (PLAN 작업 6~22와 연결)

1. `@anthropic-ai/sdk` 설치(0.134.0), `lib/refresh-types.ts` 만들기 (PLAN 5) — **2026-10-15 완료**
2. `lib/targets.ts` + `/api/targets` + `lib/run-password.ts` (PLAN 6) — **2026-10-15 완료** (실제 사이트: 대상 40개, 위치 154곳, 경고 0, 약 48초)
3. `lib/refresh-collect.ts`·`lib/refresh-extract.ts`·`lib/home-link.ts` + `/api/refresh-collect` (PLAN 7·8·11·12) — 1판 화면이 쓰는 파일과 이름이 겹치지 않게 `refresh-`를 붙임 — **2026-10-15 완료** (실제 40개: 실패 0, 그림 198개·캡처 실패 0, 바로가기 짝 42개, 연도 문장 204개·캡처 실패 0, 요청당 응답 최대 약 0.7MB)
4. `lib/ai-judge.ts` + `/api/judge` (PLAN 9·10) — **2026-10-15 완료** (그림 8개 시험: 8개 모두 사람 판독과 일치, 그림당 2~5초)
5. `scripts/run-dev.ts`로 전체 실행 → 20개 대조 (PLAN 13·14)
6. 화면 3개, 1판 파일 `trash-can/`으로 (PLAN 15~17)
7. `lib/group.ts`·`lib/excel.ts`·`lib/download.ts` (PLAN 18~21)
8. 처음부터 끝까지 PC·배포본 확인, Vercel에 `ANTHROPIC_API_KEY`·`RUN_PASSWORD` 넣기 (PLAN 22)

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-10-15 | 2판 처음 작성 (요구사항 문서 기준, 사이트 조사 결과·담당자 결정 반영) |
| 2026-10-15 | 구현 1: SDK 설치, 타입을 `lib/refresh-types.ts`로(1판 화면 유지 위해), 그림 캡처를 AI 판단이 아닌 수집 때 서버 브라우저가 찍도록 바꿈(그림 줄이기 패키지가 필요 없게), 1판 파일 정리는 화면 교체 작업으로 미룸 |
| 2026-10-15 | 구현 2: `lib/targets.ts`·`/api/targets`·`lib/run-password.ts` 추가. 표 이름 맞추기에 조사 "의" 무시 단계 추가, 홈페이지 하위 메뉴는 사이트맵에서 읽음, 바로가기 주소 맞추는 순서(주소→폴더→문구) 정함, `/api/targets` 시간 한도 120초로 늘림(실측 48초) |
| 2026-10-15 | 구현 3: `lib/refresh-collect.ts`·`lib/refresh-extract.ts`·`lib/home-link.ts`·`/api/refresh-collect` 추가. 소제목 영역 = 슬라이드, 바로가기는 같은 슬라이드 그림과만 짝(콘텐츠 전체 1개 규칙 폐기), 서버는 버튼만 돌려주고 홈페이지 경로는 화면에서 계산, 그림 캡처는 페이지 안 캔버스로, 문장 캡처는 복사본을 맨 위에 띄워 찍음(slick 이름표 제거), 요청당 최대 4페이지, 스스로하기 제목은 3단계 메뉴 이름 |
| 2026-10-15 | 구현 4: `lib/ai-judge.ts`·`/api/judge` 추가, `lib/server-limit.ts`에 `JUDGE_SLOTS`(3). 구조화 출력은 JSON 스키마 직접 작성(zod 설치 안 함), `max_tokens` 4000, 그림 종류는 파일 첫 부분으로 판별 |
