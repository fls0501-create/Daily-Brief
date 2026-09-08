/**
 * api/get-news.js
 * -------------------------------------------------------------
 * 프론트엔드(assets/app.js)가 호출하는 조회 전용 엔드포인트입니다.
 * update-news.js가 Upstash Redis에 저장해 둔 최신 데이터를 그대로 읽어 반환합니다.
 *
 * 엔드포인트: /api/get-news
 * -------------------------------------------------------------
 */

const storage = require("../lib/storage");

const NEWS_KEY = "news:latest";

module.exports = async (req, res) => {
  try {
    const data = await storage.getJSON(NEWS_KEY);

    if (!data) {
      res.setHeader("Cache-Control", "public, max-age=60");
      res.status(200).json({
        lastUpdated: null,
        articleCount: 0,
        articles: [],
        notice: "아직 첫 자동 수집이 실행되지 않았습니다. 화면의 새로고침 버튼을 눌러 첫 수집을 실행해 보세요.",
      });
      return;
    }

    res.setHeader("Cache-Control", "public, max-age=60");
    res.status(200).json(data);
  } catch (err) {
    console.error("[get-news] 오류:", err);
    res.status(500).json({ error: err.message });
  }
};
