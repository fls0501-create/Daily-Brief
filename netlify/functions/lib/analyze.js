/**
 * Google Gemini API(무료 티어)를 호출해서
 *   1) 후보 기사 중 진짜 "금융소비자보호" 관련 기사만 골라내고
 *   2) 각 기사를 화면에 쓸 형태로 요약합니다.
 *
 * Gemini API의 무료 티어(Google AI Studio)는 신용카드 등록이나 만료 없이
 * 계속 무료로 쓸 수 있습니다 (요청 빈도 제한만 있음, 2026년 기준 Flash 계열
 * 하루 약 1,000~1,500회). 이 프로젝트는 하루 몇 번의 배치 호출만 하므로
 * 이 한도 안에서 충분히 무료로 운영됩니다.
 *
 * 참고: 무료 티어는 입력/출력 데이터를 구글이 모델 개선에 활용할 수 있습니다.
 * 이 프로젝트가 다루는 데이터는 공개된 뉴스 기사 제목/요약이라 민감정보가 아니므로
 * 문제되지 않지만, 내부 기밀 데이터를 다루게 될 경우엔 유료 티어(Vertex AI 등)로
 * 전환하는 것을 고려하세요.
 *
 * 필요한 환경변수: GEMINI_API_KEY
 * 발급: https://aistudio.google.com/apikey (Google 계정만 있으면 즉시 무료 발급)
 */

const MODEL = "gemini-flash-latest"; // 무료 티어 대상 모델. 없어지면 https://ai.google.dev/gemini-api/docs/models 에서 최신 Flash 계열 이름으로 교체
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const SYSTEM_PROMPT = `당신은 국내 보험/금융 업계를 모니터링하는 애널리스트입니다.
삼성생명 소비자보호실 임원들이 매일 아침 읽는 "소비자보호 Daily Brief"에 실을 기사를 고르고 요약하는 일을 합니다.

[선별 기준]
- 금융소비자 보호와 직접 관련된 기사만 남기세요: 민원, 불완전판매, 보험금 지급/분쟁, 보이스피싱·금융사기 예방,
  소비자경보, 금융당국의 소비자보호 관련 정책·감독, 각 금융사·GA의 소비자보호 조직·제도·캠페인 등.
- 단순 실적 발표, 주가, 인사 소식, 소비자보호와 무관한 제휴 등은 제외하세요.
- 업권은 생명보험/손해보험/삼성금융사(삼성화재·삼성카드·삼성증권·삼성자산운용)/GA(법인보험대리점)/금융당국
  5개만 다룹니다. 이 5개 업권과 무관한 회사(일반 은행·카드·증권사 등) 기사는 제외하세요.

[중복 병합 — 중요]
- 같은 기관·회사의 같은 발표/사건을 다루는 기사가 여러 건 있으면 절대 각각 따로 출력하지 말고
  하나로 합쳐서 가장 정보가 풍부한 버전 하나만 남기세요.
  예: "금감원, 고령층 대상 OO 아카데미 추진"과 "금감원, 고령층 맞춤형 금융사기 예방 교육 실시"처럼
  같은 정책(고령층 금융교육)을 다른 각도에서 다룬 기사는 하나로 합쳐서 facts에 두 내용을 모두 반영하세요.
- 판단 기준: 같은 회사/기관 + 같은 날짜 + 같은 핵심 주제(정책/제도/사건)를 다루면 중복으로 간주합니다.

[요약 원칙]
- 원문 문장을 그대로 옮기지 말고 반드시 당신의 표현으로 재구성하세요(저작권 보호).
- facts는 2~3개, 각 항목은 15~40자 내외의 간결한 사실 위주 구(phrase)로 작성하세요.
- consumerAngle: 이 기사가 "소비자" 입장에서 왜 중요한지 1문장.
- internalNote: 삼성생명 소비자보호실 담당자가 참고할 점을 1문장.
- status는 다음 중 하나만: "crimson"(주의·경보·제재·비판적 이슈), "teal"(일반 모니터링·제도변경), "gold"(우수사례·성과).
- statusLabel은 status의 의미를 2~5자 한글로 표현.
- sector는 다음 중 하나만 사용: "생보", "손보", "삼성금융", "GA", "당국" (제공된 companyHint/sectorHint를 우선 참고).
  이 5개 중 어디에도 속하지 않으면 해당 기사는 아예 출력하지 마세요.

[출력 형식]
아래 JSON 스키마를 따르는 JSON 배열만 출력하세요. 설명, 코드블록 마크다운은 포함하지 마세요.
소비자보호와 무관한 기사, 5개 업권에 속하지 않는 기사, 중복 기사는 배열에서 제외하세요(빈 배열도 가능).

[
  {
    "id": "입력으로 받은 id를 그대로 반환 (병합한 경우, 대표로 삼은 기사의 id 하나만 반환)",
    "company": "회사/기관명",
    "sector": "생보 | 손보 | 삼성금융 | GA | 당국",
    "title": "간결하게 다듬은 기사 제목",
    "date": "YYYY.MM.DD",
    "facts": ["핵심 사실 1", "핵심 사실 2"],
    "consumerAngle": "소비자 관점 한 문장",
    "internalNote": "당사 참고사항 한 문장",
    "status": "crimson | teal | gold",
    "statusLabel": "짧은 한글 라벨"
  }
]`;

async function analyzeBatch(candidates) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY 환경변수가 설정되어 있지 않습니다. " +
      "https://aistudio.google.com/apikey 에서 무료로 발급받은 뒤 " +
      "Netlify > Site settings > Environment variables 에서 등록해 주세요."
    );
  }
  if (candidates.length === 0) return [];

  const userContent = JSON.stringify(
    candidates.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      date: c.dateStr,
      source: c.source,
      companyHint: c.companyHint || null,
      sectorHint: c.sectorHint || null,
    })),
    null,
    2
  );

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `다음은 오늘 수집된 후보 기사 목록입니다. 위 기준에 따라 선별·요약해서 JSON 배열로만 응답하세요.\n\n${userContent}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8000,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API 오류 (${res.status}): ${body}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!text) return [];

  let raw = text.trim();
  raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");

  // 혹시 앞뒤로 설명 문장이 섞여 오면 JSON 배열 부분만 추출
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    raw = raw.slice(start, end + 1);
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Gemini 응답 JSON 파싱 실패:", err.message, "\n원문:", raw.slice(0, 500));
    return [];
  }
}

/** 후보 기사를 한 번의 호출로 모두 분석합니다.
 *  (Gemini 무료 티어는 분당 5회 요청 제한이 있고, Netlify 함수 실행시간 제한(스케줄 30초/수동 60초)도
 *   있어서, 여러 번 나눠 호출하며 대기하는 방식 대신 "한 번에 몰아서" 처리하는 방식으로 설계했습니다.
 *   대신 MAX_CANDIDATES(update-news.js)를 넉넉하지 않게 유지해서 한 번의 응답 안에 다 담기게 합니다.) */
async function analyzeAll(candidates) {
  if (candidates.length === 0) return [];
  try {
    return await analyzeBatch(candidates);
  } catch (err) {
    console.error("기사 분석 중 오류:", err.message);
    return [];
  }
}

/** 오늘 수집된 기사 전체를 바탕으로 "최근 동향 요약"을 2~3문장으로 생성 */
async function generateTrendSummary(articles) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || articles.length === 0) return "";

  const listText = articles
    .slice(0, 30)
    .map((a) => `- [${a.sector}] ${a.company}: ${a.title} (${a.facts?.[0] || ""})`)
    .join("\n");

  const prompt = `당신은 삼성생명 소비자보호실 임원을 위한 애널리스트입니다.
아래는 최근 수집된 보험/금융 소비자보호 관련 기사 목록입니다.

${listText}

이 목록을 바탕으로 "금융당국의 정책·감독 동향"과 "타 보험사·은행·카드사의 소비자보호 관련 움직임"을
종합해서 임원이 아침에 읽을 수 있는 동향 요약을 작성하세요.

작성 원칙:
- 2~3문장, 총 200자 내외
- 특정 기사 하나를 나열하지 말고, 여러 기사를 관통하는 흐름·패턴을 짚을 것
  (예: "당국은 ~하는 방향으로 감독을 강화하는 한편, 업계는 ~한 움직임을 보이고 있다" 같은 종합 서술)
- 문장 앞뒤로 따옴표, 마크다운, 설명 문구를 붙이지 말고 본문만 출력
- 원문 기사 문장을 그대로 옮기지 말고 당신의 표현으로 재구성할 것`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 500 },
      }),
    });
    if (!res.ok) return "";
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    return text.trim();
  } catch (err) {
    console.error("동향 요약 생성 실패:", err.message);
    return "";
  }
}

module.exports = { analyzeBatch, analyzeAll, generateTrendSummary };
