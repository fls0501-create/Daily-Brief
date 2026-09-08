# 소비자보호 Daily Brief — Vercel 버전 (완전 무료)

Netlify 대신 **Vercel**에 배포하는 버전입니다. 화면 디자인과 기능은 100% 동일하고,
저장소만 Netlify Blobs → **Upstash Redis**로 교체했습니다 (Vercel이 자체 KV를 없애서
외부 무료 서비스를 붙이는 방식이 표준입니다).

> ⚠️ **참고**: Vercel 무료(Hobby) 요금제는 약관상 "개인/비상업적 용도"로 한정되어 있습니다.
> 회사 내부 업무용으로 계속 쓰실 계획이면, 나중에 Vercel Pro($20/월) 또는
> Netlify 유료 플랜으로 전환하는 것을 권장드립니다. 지금은 우선 무료로 빠르게
> 다시 돌아가는 것을 목표로 안내해 드립니다.

---

## 1. 폴더 구조

```
/
├── index.html                ← 화면 (디자인 동일)
├── assets/
│   ├── style.css
│   └── app.js                ← API 경로만 /api/* 로 변경됨
├── api/
│   ├── update-news.js        ← 크론(매일 자동) + 새로고침 버튼이 호출하는 핵심 로직
│   └── get-news.js           ← 화면이 데이터를 읽어오는 API
├── lib/
│   ├── companies.js          ← 회사명 → 업권(생보/손보/삼성금융사/GA사/당국) 매핑 사전
│   ├── google-news.js        ← Google News RSS 검색 (키 불필요, 무료)
│   ├── analyze.js            ← Gemini로 선별+요약 (완전 무료)
│   └── storage.js            ← Upstash Redis 저장소 (Netlify Blobs 대체)
├── vercel.json                ← 크론 스케줄 설정
├── package.json
├── .env.example
└── README.md
```

Netlify 버전과 달라진 핵심은 **`netlify/functions/*` → `api/*`**, **Netlify Blobs → Upstash Redis**
두 가지뿐입니다. 검색·분석 로직(`lib/` 폴더)은 완전히 동일합니다.

---

## 2. 전체 동작 흐름

```
[매일 07:00 KST 자동] 또는 [화면의 "새로고침" 버튼 클릭 시 즉시]
  /api/update-news
    → Google News RSS로 키워드 11개 검색 (무료)
    → 최근 3일 + 중복 제거 → 회사/기관명 매칭 (5개 업권만)
    → Gemini가 선별 + 요약 + 유사 중복 병합
    → Upstash Redis에 저장 (최근 60일치 보관)

[사용자가 사이트 접속]
  index.html → app.js → /api/get-news 호출 → 화면 렌더링
```

Vercel의 크론은 **하루 1번**만 자동 실행되지만, `/api/update-news`는 평범한 API
엔드포인트라서 화면의 새로고침 버튼이 언제든 직접 호출할 수 있습니다
(크론 횟수 제한은 Vercel이 자기 스케줄러로 부르는 것에만 적용됩니다).

---

## 3. 필요한 것 준비하기 (전부 무료)

### (1) Gemini API 키 — 이미 있으시면 그대로 재사용

이전에 발급받은 키(`AIza...`)를 그대로 쓰시면 됩니다. 새로 받을 필요 없습니다.
없으시면 https://aistudio.google.com/apikey 에서 발급.

### (2) Upstash Redis — 새로 만들어야 함

1. https://console.upstash.com 접속 → GitHub 계정으로 가입/로그인 (무료, 카드 불필요)
2. **Create Database** 클릭
3. 이름은 아무거나 (예: `consumer-protection-brief`), Region은 아무 곳이나 (가까운 곳 추천)
4. Type은 **Regional** 선택 (무료 티어)
5. 생성되면 대시보드에 들어가서 **REST API** 탭 클릭
6. **`UPSTASH_REDIS_REST_URL`** 과 **`UPSTASH_REDIS_REST_TOKEN`** 두 값이 보입니다 → 메모해두기

---

## 4. GitHub 저장소 준비

기존에 쓰던 저장소(`Daily-Brief`)를 그대로 재사용해도 되고, 새로 만들어도 됩니다.
기존 저장소를 재사용하는 경우:

1. 기존 저장소에서 `netlify.toml`, `netlify/` 폴더는 **삭제**해도 되고 그냥 둬도 무방합니다
   (Vercel이 그냥 무시합니다. 깔끔하게 정리하고 싶으면 지우세요)
2. 이번에 받은 zip 안의 파일 전체(`api/`, `lib/`, `vercel.json`, 새 `assets/app.js` 등)를
   같은 방식으로 **Add file → Upload files** 로 업로드 → Commit

---

## 5. Vercel에 배포하기

1. https://vercel.com 접속 → **Continue with GitHub** 로 로그인
2. **Add New... → Project** 클릭
3. 저장소 목록에서 `Daily-Brief` 찾아서 **Import** 클릭
4. Framework Preset은 **Other**로 두고, 나머지 설정은 건드리지 않아도 됩니다
   (vercel.json이 알아서 인식됩니다)
5. **환경변수 등록** — Import 화면 안에 "Environment Variables" 섹션이 있습니다:

   | Key | Value |
   |---|---|
   | `GEMINI_API_KEY` | 기존에 쓰던 Gemini 키 |
   | `UPSTASH_REDIS_REST_URL` | 3-(2)에서 받은 값 |
   | `UPSTASH_REDIS_REST_TOKEN` | 3-(2)에서 받은 값 |
   | `MANUAL_UPDATE_SECRET` | (선택, 비워도 됨) |

6. **Deploy** 클릭
7. 1분 이내로 배포 완료 → `https://무언가.vercel.app` 주소 생성

(환경변수를 나중에 추가/수정했다면 Project → Settings → Environment Variables에서
등록 후 **Deployments 탭 → 최신 배포 옆 ⋮ → Redeploy** 로 재배포하면 반영됩니다)

---

## 6. 첫 데이터 채워넣기

배포 직후엔 데이터가 없는 게 정상입니다. 사이트 접속 → **"새로고침" 버튼** 클릭 →
10~30초 기다리면 기사가 채워집니다.

---

## 7. 크론(매일 자동 실행)이 잘 등록됐는지 확인하는 법

1. Vercel 대시보드 → 프로젝트 선택 → 상단 **Settings** 탭 → 왼쪽 **Cron Jobs**
2. `/api/update-news` 항목이 `0 22 * * *` (UTC 22:00 = 한국시간 오전 7시) 스케줄로
   등록되어 있는지 확인
3. 실행 이력은 프로젝트 **Logs** 탭에서 확인 가능

시간을 한국시간 오전 8시로 바꾸고 싶으면 `vercel.json`의 `"schedule"` 값을
`"0 23 * * *"`로 바꾸고 다시 배포하면 됩니다.

---

## 8. 자주 겪을 수 있는 문제

| 증상 | 원인/해결 |
|---|---|
| "새로고침" 눌러도 "갱신 실패" | Vercel → Logs에서 `/api/update-news` 로그 확인. 대부분 환경변수 미등록 |
| Upstash 관련 오류 | `UPSTASH_REDIS_REST_URL`/`TOKEN` 오타 확인, Upstash 콘솔에서 값 다시 복사 |
| Gemini "503" 오류 | 구글 서버 일시적 과부하. 코드에 자동 재시도가 들어있어 대부분 자동 해결됨 |
| 크론이 실행 안 된 것 같음 | Settings → Cron Jobs에서 등록 여부 확인, 무료 요금제는 하루 1번만 허용됨 |
| "이미 실행 중…" 메시지만 계속 뜸 | 새로고침을 여러 번 연달아 눌렀을 가능성. 1분 정도 기다렸다가 다시 시도 |

---

## 9. 나중에 커스터마이징하고 싶을 때

- **검색 키워드**: `api/update-news.js`의 `KEYWORDS` 배열
- **회사명 사전**: `lib/companies.js`의 `COMPANIES` 객체
- **요약 톤/기준**: `lib/analyze.js`의 `SYSTEM_PROMPT`
- **디자인**: `assets/style.css`
- **크론 시각**: `vercel.json`의 `schedule` (UTC 기준)
