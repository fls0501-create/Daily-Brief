/**
 * Google News RSS 검색 유틸 — API 키 불필요, 완전 무료
 *
 * https://news.google.com/rss/search?q=검색어&hl=ko&gl=KR&ceid=KR:ko
 * 형태의 URL로 요청하면 검색 결과를 RSS(XML)로 돌려줍니다.
 * 별도 가입/키 발급 절차가 없고, 요청량 제한도 네이버처럼 엄격하지 않습니다.
 *
 * 주의: 응답의 <link>는 news.google.com 리다이렉트 링크입니다.
 * 클릭하면 원문으로 정상 이동하지만, 원문 도메인이 아니라는 점만 참고하세요.
 */

const RSS_BASE = "https://news.google.com/rss/search";

/** XML 엔티티 디코딩 (CDATA, &lt; 등) */
function decodeXmlEntities(str = "") {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** <item>...</item> 블록에서 태그 하나를 추출하는 간단한 헬퍼 */
function extractTag(itemXml, tag) {
  const m = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeXmlEntities(m[1]) : "";
}

/** description 안의 HTML 태그(주로 <a>...</a>)를 제거해 순수 텍스트만 남김 */
function stripHtml(str = "") {
  return str.replace(/<[^>]*>/g, "").trim();
}

/** "Fri, 04 Sep 2026 09:25:00 GMT" 같은 RSS 날짜 → Date 객체 */
function parsePubDate(pubDate) {
  const d = new Date(pubDate);
  return isNaN(d.getTime()) ? null : d;
}

/** Date 객체 → "2026.09.04" (한국 시간 기준) */
function toKstDateString(date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000 - date.getTimezoneOffset() * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}.${m}.${d}`;
}

/**
 * 단일 키워드로 Google News RSS 검색
 * @param {string} query 검색어
 * @returns {Promise<Array>} 정제된 기사 목록
 */
async function searchGoogleNews(query) {
  const url = `${RSS_BASE}?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;

  const res = await fetch(url, {
    headers: {
      // 일부 응답이 User-Agent 없이는 비어 오는 경우가 있어 명시
      "User-Agent": "Mozilla/5.0 (compatible; ConsumerProtectionBriefBot/1.0)",
    },
  });

  if (!res.ok) {
    throw new Error(`Google News RSS 오류 (${res.status}) — 검색어: ${query}`);
  }

  const xml = await res.text();
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  return itemBlocks.map((itemXml) => {
    const rawTitle = extractTag(itemXml, "title");
    // Google News 제목은 보통 "기사 제목 - 언론사명" 형태로 옴 → 언론사명 분리
    const titleMatch = rawTitle.match(/^(.*)\s-\s([^-]+)$/);
    const title = titleMatch ? titleMatch[1].trim() : rawTitle;
    const sourceFromTitle = titleMatch ? titleMatch[2].trim() : "";

    const sourceTag = extractTag(itemXml, "source"); // <source url="...">언론사명</source>

    const pubDateRaw = extractTag(itemXml, "pubDate");
    const pubDate = parsePubDate(pubDateRaw);

    return {
      title,
      description: stripHtml(extractTag(itemXml, "description")),
      link: extractTag(itemXml, "link"),
      source: sourceTag || sourceFromTitle || "",
      pubDate,
      dateStr: pubDate ? toKstDateString(pubDate) : null,
    };
  });
}

/** 여러 키워드로 검색해서 하나의 배열로 합침 */
async function searchMultiple(queries) {
  const all = [];
  for (const q of queries) {
    try {
      const results = await searchGoogleNews(q);
      all.push(...results);
    } catch (err) {
      console.error(`"${q}" 검색 중 오류:`, err.message);
    }
    // 과도한 연속 요청 방지용 짧은 딜레이
    await new Promise((r) => setTimeout(r, 150));
  }
  return all;
}

/** 최근 N일 이내 기사만 남기고, link + 정규화된 제목 기준으로 중복 제거 */
function filterRecentAndDedupe(articles, days = 3) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const seenLinks = new Set();
  const seenTitles = new Set();
  const result = [];

  for (const a of articles) {
    if (!a.pubDate || a.pubDate.getTime() < cutoff) continue;
    if (!a.link || seenLinks.has(a.link)) continue;

    // 제목 정규화 후 유사 중복 제거 (한글·영문·숫자만 남김, 유니코드 속성 이스케이프 사용)
    const normalized = a.title.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 30);
    if (normalized.length > 5 && seenTitles.has(normalized)) continue;

    seenLinks.add(a.link);
    if (normalized.length > 5) seenTitles.add(normalized);
    result.push(a);
  }

  return result;
}

module.exports = { searchGoogleNews, searchMultiple, filterRecentAndDedupe, toKstDateString };
