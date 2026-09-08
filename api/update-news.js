/**
 * api/update-news.js
 * -------------------------------------------------------------
 * 이 엔드포인트는 두 가지 방식으로 호출됩니다:
 *   1) Vercel Cron — vercel.json에 설정된 대로 매일 한국시간 오전 7시에 자동 호출
 *   2) 화면의 "새로고침" 버튼 — 사용자가 클릭하면 즉시 같은 엔드포인트를 호출
 *      (Vercel의 "크론은 하루 1번" 제한은 Vercel 자체 스케줄러에만 적용되고,
 *       이 엔드포인트를 다른 곳에서 직접 호출하는 것은 제한되지 않습니다)
 *
 * 동작:
 *   1) Google News RSS로 기사 검색 (무료, 키 불필요)
 *   2) 최근 N일 이내 + 중복 제거
 *   3) 회사/기관명 자동 추출 (companies.js 사전 — 생보/손보/삼성금융/GA/당국 5개 업권만)
 *   4) Gemini(무료 티어)로 "진짜 소비자보호 기사"만 선별 + 요약 + 유사 중복 병합
 *   5) 기존 데이터와 합쳐 Upstash Redis에 저장
 *
 * 필요한 환경변수:
 *   GEMINI_API_KEY (https://aistudio.google.com/apikey)
 *   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (https://console.upstash.com)
 *   (선택) MANUAL_UPDATE_SECRET — 이 엔드포인트를 아무나 실행 못 하게 막고 싶을 때
 * -------------------------------------------------------------
 */

const { searchMultiple, filterRecentAndDedupe } = require("../lib/google-news");
const { extractCompanies } = require("../lib/companies");
const { analyzeAll, generateTrendSummary } = require("../lib/analyze");
const storage = require("../lib/storage");

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
const MAX_CANDIDATES = 25;
const RETENTION_DAYS = 60;
const NEWS_KEY = "news:latest";
const LOCK_KEY = "news:lock";
const LOCK_TTL_MS = 50 * 1000;
const ALLOWED_SECTORS = ["생보", "손보", "삼성금융", "GA", "당국"];

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

  const analyzed = await analyzeAll(candidates);
  console.log(`[update-news] Gemini 분석 결과 ${analyzed.length}건 (소비자보호 관련으로 확정)`);

  const byId = new Map(candidates.map((c) => [c.id, c]));
  return analyzed
    .map((a) => {
      const orig = byId.get(a.id);
      if (!orig) return null;
      const sector = normalizeSector(a.sector || orig.sectorHint);
      if (!sector) return null;
      return {
        company: a.company || orig.companyHint || "미상",
        sector,
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
  return ALLOWED_SECTORS.includes(s) ? s : null;
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

/** 잠금 확보 이후 실제 수집 로직 */
async function doUpdate(reset) {
  let existingArticles = [];
  if (!reset) {
    const existingRaw = await storage.getJSON(NEWS_KEY).catch(() => null);
    existingArticles = existingRaw?.articles || [];
    existingArticles = existingArticles.filter((a) => ALLOWED_SECTORS.includes(a.sector));
  }

  const incoming = await collectAndAnalyze();
  const merged = mergeArticles(existingArticles, incoming);

  const latestDate = merged[0]?.date;
  const recentForTrend = merged.filter((a) => a.date === latestDate).length >= 5
    ? merged.filter((a) => a.date === latestDate)
    : merged.slice(0, 15);
  const trendSummary = await generateTrendSummary(recentForTrend);

  const payload = {
    lastUpdated: new Date().toISOString(),
    articleCount: merged.length,
    newThisRun: incoming.length,
    trendSummary,
    articles: merged,
  };

  await storage.setJSON(NEWS_KEY, payload);

  console.log(
    `[update-news] 완료 — 신규 ${incoming.length}건, 전체 보관 ${merged.length}건, 저장 시각 ${payload.lastUpdated}`
  );

  return payload;
}

/** 동시 실행 방지: 이미 실행 중이면 새 실행을 건너뛰고 현재 저장된 값을 그대로 반환 */
async function runUpdate(reset = false) {
  const existingLock = await storage.getJSON(LOCK_KEY).catch(() => null);
  if (existingLock && Date.now() - existingLock.startedAt < LOCK_TTL_MS) {
    console.warn("[update-news] 이미 다른 실행이 진행 중이라 이번 요청은 건너뜁니다.");
    const current = await storage.getJSON(NEWS_KEY).catch(() => null);
    return {
      lastUpdated: current?.lastUpdated || null,
      articleCount: current?.articles?.length || 0,
      newThisRun: 0,
      skipped: true,
      trendSummary: current?.trendSummary || "",
      articles: current?.articles || [],
    };
  }

  await storage.setJSON(LOCK_KEY, { startedAt: Date.now() });
  try {
    return await doUpdate(reset);
  } finally {
    await storage.del(LOCK_KEY).catch(() => {});
  }
}

// ---- Vercel Serverless Function 진입점 ----------------------------------

module.exports = async (req, res) => {
  // Vercel Cron이 호출할 때는 Authorization 헤더에 CRON_SECRET이 자동으로 실림 (설정한 경우)
  const cronSecret = process.env.CRON_SECRET;
  const isCronCall = req.headers.authorization === `Bearer ${cronSecret}`;

  const manualSecret = process.env.MANUAL_UPDATE_SECRET;
  if (manualSecret && !isCronCall) {
    if (req.query.secret !== manualSecret) {
      res.status(401).json({ ok: false, error: "secret 파라미터가 올바르지 않습니다." });
      return;
    }
  }

  try {
    const reset = req.query.reset === "true";
    const payload = await runUpdate(reset);
    res.status(200).json({
      ok: true,
      skipped: !!payload.skipped,
      newThisRun: payload.newThisRun,
      total: payload.articleCount,
      lastUpdated: payload.lastUpdated,
    });
  } catch (err) {
    console.error("[update-news] 실행 중 오류:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
