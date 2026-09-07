/**
 * update-news.js
 * -------------------------------------------------------------
 * Netlify Scheduled Function + 수동/버튼 실행 겸용.
 *
 * 비용을 최소화한 구성입니다:
 *   1) Google News RSS로 기사 검색 (API 키 불필요, 완전 무료)
 *   2) 최근 N일 이내 + 중복 제거
 *   3) 회사/기관명 자동 추출 (companies.js 사전)
 *   4) Gemini(무료 티어)로 "진짜 소비자보호 기사"만 선별 + 요약
 *      → 웹 검색 도구를 쓰지 않으므로 검색 비용이 전혀 들지 않습니다.
 *   5) 기존 데이터와 합쳐 Netlify Blobs에 저장
 *
 * 필요한 환경변수: GEMINI_API_KEY 하나만 있으면 됩니다. (완전 무료, 카드 등록 불필요)
 * (네이버 API는 2026.9.7 약관 개정으로, Anthropic API는 유료 종량제라 각각 제외했고,
 *  Google News RSS + Gemini 무료 티어 조합으로 완전 무료를 달성했습니다.
 *  Google AI Studio(Gemini)의 무료 티어는 카드 등록·만료 없이 계속 무료로 쓸 수 있습니다.)
 *
 * cron 표현식은 UTC 기준입니다.
 *   - 한국시간(KST) 오전 7시 = UTC 22:00 (전날) → "0 22 * * *"
 *   - 한국시간(KST) 오전 8시 = UTC 23:00 (전날) → "0 23 * * *"
 * -------------------------------------------------------------
 */

const { schedule } = require("@netlify/functions");
const { getStore, connectLambda } = require("@netlify/blobs");
const { searchMultiple, filterRecentAndDedupe } = require("./lib/google-news");
const { extractCompanies } = require("./lib/companies");
const { analyzeAll } = require("./lib/analyze");

const KEYWORDS = [
  "소비자보호",
  "금융소비자",
  "민원",
  "불완전판매",
  "보험금",
  "보험금 지급",
  "보이스피싱",
  "금융사기",
  "소비자경보",
  "금융감독원",
  "금융위원회",
];

const RECENT_DAYS = 3;
const MAX_CANDIDATES = 60;
const RETENTION_DAYS = 60;
const BLOB_STORE_NAME = "news";
const BLOB_KEY = "latest";

async function collectAndAnalyze() {
  console.log(`[update-news] 수집 시작 — 키워드 ${KEYWORDS.length}개`);

  const raw = await searchMultiple(KEYWORDS);
  console.log(`[update-news] 원시 검색 결과 ${raw.length}건`);

  const recent = filterRecentAndDedupe(raw, RECENT_DAYS);
  console.log(`[update-news] 최근 ${RECENT_DAYS}일 + 중복제거 후 ${recent.length}건`);

  const withCompany = recent
    .map((a) => ({ ...a, matches: extractCompanies(`${a.title} ${a.description}`) }))
    .filter((a) => a.matches.length > 0);
  console.log(`[update-news] 회사/기관명 매칭된 기사 ${withCompany.length}건`);

  const candidates = withCompany
    .sort((a, b) => (b.pubDate?.getTime() || 0) - (a.pubDate?.getTime() || 0))
    .slice(0, MAX_CANDIDATES)
    .map((a, idx) => ({
      id: `cand-${idx}-${Date.now()}`,
      title: a.title,
      description: a.description,
      dateStr: a.dateStr,
      source: a.source || guessSourceName(a.link),
      link: a.link,
      companyHint: a.matches[0]?.name || null,
      sectorHint: a.matches[0]?.sector || null,
    }));

  if (candidates.length === 0) {
    console.log("[update-news] 분석할 후보 기사가 없습니다.");
    return [];
  }

  const analyzed = await analyzeAll(candidates, 10);
  console.log(`[update-news] Gemini 분석 결과 ${analyzed.length}건 (소비자보호 관련으로 확정)`);

  const byId = new Map(candidates.map((c) => [c.id, c]));
  return analyzed
    .map((a) => {
      const orig = byId.get(a.id);
      if (!orig) return null;
      return {
        company: a.company || orig.companyHint || "미상",
        sector: normalizeSector(a.sector || orig.sectorHint),
        title: a.title || orig.title,
        date: normalizeDate(a.date) || orig.dateStr,
        facts: Array.isArray(a.facts) ? a.facts.slice(0, 3) : [],
        consumerAngle: a.consumerAngle || "",
        internalNote: a.internalNote || "",
        status: ["crimson", "teal", "gold"].includes(a.status) ? a.status : "teal",
        statusLabel: a.statusLabel || "",
        source: orig.source,
        url: orig.link,
      };
    })
    .filter(Boolean);
}

function normalizeSector(s) {
  const allowed = ["생보", "손보", "은행", "카드", "당국", "기타"];
  return allowed.includes(s) ? s : "기타";
}

function normalizeDate(d) {
  if (!d) return null;
  const m = String(d).match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return null;
  const [, y, mo, da] = m;
  return `${y}.${mo.padStart(2, "0")}.${da.padStart(2, "0")}`;
}

function guessSourceName(link) {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function mergeArticles(existing, incoming) {
  const map = new Map();
  for (const a of existing) map.set(a.url, a);
  for (const a of incoming) map.set(a.url, a);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffStr = `${cutoff.getFullYear()}.${String(cutoff.getMonth() + 1).padStart(2, "0")}.${String(
    cutoff.getDate()
  ).padStart(2, "0")}`;

  return [...map.values()]
    .filter((a) => a.date && a.date >= cutoffStr)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** 실제 수집→분석→저장을 수행하는 공용 함수 (스케줄 실행, 수동 실행, 화면의 새로고침 버튼이 모두 공유) */
async function runUpdate(event) {
  // Lambda 호환 모드에서는 Netlify Blobs 환경이 자동 설정되지 않으므로 수동 연결 필요
  if (event) connectLambda(event);

  const store = getStore(BLOB_STORE_NAME);

  const existingRaw = await store.get(BLOB_KEY, { type: "json" }).catch(() => null);
  const existingArticles = existingRaw?.articles || [];

  const incoming = await collectAndAnalyze();
  const merged = mergeArticles(existingArticles, incoming);

  const payload = {
    lastUpdated: new Date().toISOString(),
    articleCount: merged.length,
    newThisRun: incoming.length,
    articles: merged,
  };

  await store.setJSON(BLOB_KEY, payload);

  console.log(
    `[update-news] 완료 — 신규 ${incoming.length}건, 전체 보관 ${merged.length}건, 저장 시각 ${payload.lastUpdated}`
  );

  return payload;
}

const handler = async (event) => {
  try {
    const payload = await runUpdate(event);
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, newThisRun: payload.newThisRun, total: payload.articleCount }),
    };
  } catch (err) {
    console.error("[update-news] 실행 중 오류:", err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};

// 매일 한국시간 오전 7시(UTC 22:00 전날) 자동 실행
exports.handler = schedule("0 22 * * *", handler);

exports.runUpdate = runUpdate;
exports.mergeArticles = mergeArticles;
exports.collectAndAnalyze = collectAndAnalyze;
