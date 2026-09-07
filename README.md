# 소비자보호 Daily Brief — 자동 갱신 버전 (완전 무료 구성)

삼성생명 소비자보호실용 "소비자보호 Daily Brief"를 Netlify에 배포하면
**매일 한국시간 오전 7시에 자동으로**, 그리고 **화면의 "새로고침" 버튼을 누르면 즉시**
최신 보험/금융 소비자보호 기사를 수집·요약해서 화면에 반영하는 버전입니다.

디자인은 기존 정적 HTML 버전과 동일하고, 데이터만 코드에 직접 넣지 않고
서버(Netlify Functions)가 채워 넣는 구조로 바뀌었습니다.

## 💰 이 버전은 운영 비용이 0원입니다

| 단계 | 사용하는 것 | 비용 | 카드 등록 |
|---|---|---|---|
| 기사 검색 | Google News RSS | 무료 | 불필요 |
| 선별·요약 | Google Gemini API (무료 티어) | 무료 | 불필요 |
| 배포·호스팅 | Netlify (무료 플랜) | 무료 | 불필요 |
| 데이터 저장 | Netlify Blobs | 무료 | 불필요 |

**신용카드를 어디에도 등록하지 않고 완전히 무료로 운영할 수 있습니다.**

> 여기까지 오는 데 시행착오가 좀 있었습니다 — 참고로 남겨둡니다:
> - 처음엔 네이버 뉴스검색 API(무료인 줄 알았음)를 쓰려 했으나, 2026.9.7 약관 개정으로
>   "검색 결과를 AI 입력값으로 쓰는 것"이 금지되어 제외했습니다.
> - 다음엔 Claude API의 웹검색 기능을 썼으나, 검색 1회당 과금되는 종량제라 월 2~3만원 예상되어 제외했습니다.
> - Claude API를 Haiku 모델로만 쓰는 것도 시도했지만, Anthropic은 카드 등록이 필요한 종량제라
>   "완전 무료"라는 요구사항엔 맞지 않았습니다.
> - 최종적으로 **Google News RSS(키 불필요) + Gemini 무료 티어(카드 불필요, 만료 없음)**
>   조합으로 정착했습니다. Google AI Studio는 2026년 기준 업계에서 거의 유일하게
>   "카드 등록도, 만료도 없는" 무료 API 티어를 제공합니다.

---

## 1. 폴더 구조

```
/
├── index.html                        ← 화면 (디자인은 기존과 동일 + 새로고침 버튼)
├── assets/
│   ├── style.css
│   └── app.js                        ← 새로고침 버튼을 누르면 바로 백엔드 재수집을 트리거
├── data/
│   └── news.json                     ← ⚠️ 참고용 샘플일 뿐, 실제 운영 데이터 아님 (2장 참고)
├── netlify/
│   └── functions/
│       ├── update-news.js            ← 매일 자동 실행 + 새로고침 버튼이 호출하는 핵심 로직
│       ├── get-news.js               ← 프론트엔드가 데이터를 조회하는 API
│       ├── manual-update-news.js     ← 새로고침 버튼 / 수동 URL 호출용 엔드포인트
│       └── lib/
│           ├── companies.js          ← 회사명 → 업권(생보/손보/은행/카드/당국) 매핑 사전
│           ├── google-news.js        ← Google News RSS 검색 (키 불필요, 무료)
│           └── analyze.js            ← Gemini 무료 티어로 선별+요약 (완전 무료)
├── netlify.toml
├── package.json
├── .env.example
└── README.md
```

### ⚠️ 왜 `data/news.json`이 실제로 쓰이지 않나요?

Netlify Functions는 실행할 때마다 파일시스템이 초기화되는 서버리스 환경이라,
함수 안에서 정적 파일에 "매일 새로 쓰기"를 할 수 없습니다. 대신 Netlify가 제공하는
**Netlify Blobs**(사이트마다 자동 제공되는 저장소, 별도 신청 불필요, 무료)에 저장합니다.

- `update-news.js`가 데이터를 모아서 Netlify Blobs에 저장
- `get-news.js`가 그 데이터를 읽어서 프론트엔드에 JSON으로 내려줌
- `assets/app.js`는 `/.netlify/functions/get-news`를 호출해서 화면을 그림

`data/news.json`은 스키마 참고용 샘플입니다.

---

## 2. 전체 동작 흐름

```
[매일 07:00 KST 자동] 또는 [화면의 "새로고침" 버튼 클릭 시 즉시]
  update-news.js
    → google-news.js: 키워드 11개로 Google News RSS 검색 (무료, 키 불필요)
    → 최근 3일 이내 + 중복 제거
    → companies.js 사전으로 회사/기관명·업권 자동 추출
    → analyze.js: Gemini 무료 티어가 "진짜 소비자보호 기사"만 선별 + 2~3줄 요약
      + 소비자보호 관점 + 당사 참고사항 생성
    → 기존 데이터와 합쳐서 Netlify Blobs에 저장 (최근 60일치 보관)

[사용자가 사이트 접속]
  index.html → app.js → get-news 호출 → 화면 렌더링

[사용자가 "새로고침" 버튼 클릭]
  app.js → manual-update-news 호출 (위 수집 과정을 그 자리에서 즉시 실행, 보통 수십 초~1분)
    → 완료되면 get-news를 다시 호출해서 화면 갱신
```

### 참고 — Google News RSS 사용 시 알아두실 점

- 원문 링크가 `news.google.com/rss/articles/...` 형태의 **구글 리다이렉트 링크**입니다.
  "원문 보기"를 클릭하면 실제 언론사 페이지로 정상적으로 넘어갑니다.
- 네이버만큼 결과가 촘촘하지 않을 수 있어, 기사가 너무 적게 잡히면 `update-news.js`의
  `KEYWORDS`에 검색어를 더 추가하거나 `RECENT_DAYS`를 늘려보세요.

### 참고 — Gemini 무료 티어 사용 시 알아두실 점

- 무료 티어는 분당/일일 요청 횟수 제한이 있습니다 (2026년 기준 Flash 계열 하루 약 1,000회 이상).
  이 프로젝트는 하루 5~10회 정도만 호출하므로 여유 있게 무료 한도 안에서 운영됩니다.
- 무료 티어는 구글이 입력/출력 데이터를 모델 개선에 활용할 수 있다는 점을 알아두세요.
  이 프로젝트가 다루는 데이터는 이미 공개된 뉴스 기사라 문제되지 않지만,
  내부 기밀 데이터를 다루게 되면 유료 티어(카드 등록 필요)로 전환을 고려해야 합니다.

---

## 3. 필요한 API 키 발급받기 (완전 무료)

### Google AI Studio(Gemini) API 키

1. https://aistudio.google.com/apikey 접속
2. Google 계정으로 로그인 (개인 Gmail 계정이면 충분합니다)
3. **"Create API key"** 클릭 → 새 프로젝트 생성(또는 기존 프로젝트 선택)
4. 생성된 키(`AIza...`로 시작)를 복사해 메모해두기
5. **결제 정보 입력 화면이 뜨지 않습니다.** 카드 등록 없이 바로 사용 가능합니다.

> 이 키는 **절대 코드에 직접 적지 마세요.** 6장에서 Netlify 환경변수로 등록합니다.
> (Google News는 키 발급 절차 자체가 없습니다 — 그냥 바로 씁니다)

---

## 4. 로컬에서 파일 받기

제가 만들어드린 프로젝트 zip 파일을 다운로드해서 압축을 풀면 위 폴더 구조 그대로 나옵니다.

---

## 5. Netlify에 배포하기

### 방법 A. GitHub 연동 배포 (추천)

1. https://github.com/new 에서 새 저장소 생성
2. 압축 푼 프로젝트 폴더 전체를 그 저장소에 업로드
   ("Add file → Upload files"로 드래그해서 올려도 됩니다)
3. https://app.netlify.com 접속 → **Add new site → Import an existing project**
4. **GitHub** 선택 → 방금 만든 저장소 선택 → **Deploy site**
5. 몇 분 뒤 `https://무작위이름.netlify.app` 주소로 사이트가 생성됩니다
   (Netlify 무료 플랜도 카드 등록 없이 시작 가능합니다)

### 방법 B. Netlify CLI로 배포

```bash
npm install -g netlify-cli
npm install
netlify login
netlify init
netlify deploy --prod
```

---

## 6. 환경변수 등록하기 — 중요!

1. https://app.netlify.com → 방금 만든 사이트 → **Site configuration → Environment variables**
2. **Add a variable** 로 아래 항목들을 등록

| Key | Value |
|---|---|
| `GEMINI_API_KEY` | 3장에서 발급받은 Gemini API 키 (`AIza...`) |
| `MANUAL_UPDATE_SECRET` | (선택, 내부용 도구면 생략 가능) |

3. 등록 후 **Deploys 탭 → ⋮ 메뉴 → Trigger deploy → Deploy site** 로 재배포
   (환경변수는 등록 이후의 배포부터 적용됩니다)

---

## 7. 첫 데이터 채워넣기

배포 직후에는 아직 한 번도 수집이 안 된 상태라 화면에 기사가 없습니다.
사이트에 접속해서 **"새로고침" 버튼을 한 번 눌러주세요.** 수십 초 정도 기다리면
"완료 (신규 N건)"으로 바뀌면서 화면에 기사가 채워집니다.

이후로는 매일 한국시간 오전 7시에 자동으로 같은 작업이 반복되고,
언제든 새로고침 버튼으로 즉시 최신화할 수도 있습니다.

---

## 8. Scheduled Function이 정상 실행되는지 확인하는 법

1. https://app.netlify.com → 사이트 선택 → 상단 **Logs**(또는 **Functions**) 탭
2. `update-news` 클릭 → Function log에서 실행 시각과 로그 확인
3. 실행 시각을 바꾸려면 `netlify/functions/update-news.js` 맨 아래:
   ```js
   exports.handler = schedule("0 22 * * *", handler); // UTC 22:00 = KST 07:00
   ```
   한국시간 오전 8시로 바꾸려면 → `"0 23 * * *"`

---

## 9. 자주 겪을 수 있는 문제

| 증상 | 원인/해결 |
|---|---|
| "새로고침" 눌러도 "갱신 실패" | Netlify → Logs → `manual-update-news` 로그 확인 (GEMINI_API_KEY 미등록이 가장 흔한 원인) |
| 화면에 "기사 데이터를 불러오지 못했습니다" | `get-news` 함수 오류. Logs에서 확인 |
| Gemini 호출이 "429 Too Many Requests" | 무료 티어 분당/일일 한도 초과. 잠시 후 다시 시도하거나 `analyze.js`의 배치 간 딜레이(1500ms)를 늘려보기 |
| 기사가 너무 적게 수집됨 | `update-news.js`의 `KEYWORDS`에 검색어 추가, `MAX_CANDIDATES`/`RECENT_DAYS` 값 조정 |
| 특정 회사 기사가 전혀 안 잡힘 | `netlify/functions/lib/companies.js` 사전에 그 회사명이 등록되어 있는지 확인 |
| "원문 보기" 클릭 시 구글 도메인이 잠깐 보임 | 정상입니다. Google News RSS의 리다이렉트 링크 구조상 그렇습니다 |
| Gemini 모델명 오류(404 등) | `analyze.js`의 `MODEL` 값이 만료되었을 수 있습니다. https://ai.google.dev/gemini-api/docs/models 에서 현재 무료 티어 Flash 계열 모델명 확인 후 교체 |

---

## 10. 나중에 커스터마이징하고 싶을 때

- **검색 키워드**: `netlify/functions/update-news.js`의 `KEYWORDS` 배열
- **회사명 사전**: `netlify/functions/lib/companies.js`의 `COMPANIES` 객체
- **요약 톤/기준**: `netlify/functions/lib/analyze.js`의 `SYSTEM_PROMPT`
- **디자인**: `assets/style.css` (색상 변수는 파일 상단 `:root`)
- **보관 기간**: `update-news.js`의 `RETENTION_DAYS` (기본 60일)
