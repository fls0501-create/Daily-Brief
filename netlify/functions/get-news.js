/**
 * get-news.js
 * -------------------------------------------------------------
 * 프론트엔드(assets/app.js)가 호출하는 조회 전용 함수입니다.
 * update-news.js 가 Netlify Blobs에 저장해 둔 최신 데이터를 그대로 읽어 반환합니다.
 *
 * 엔드포인트: /.netlify/functions/get-news
 * -------------------------------------------------------------
 */

const { getStore, connectLambda } = require("@netlify/blobs");

const BLOB_STORE_NAME = "news";
const BLOB_KEY = "latest";

exports.handler = async (event) => {
  try {
    // Lambda 호환 모드에서는 Netlify Blobs 환경이 자동 설정되지 않으므로 수동 연결 필요
    connectLambda(event);

    const store = getStore(BLOB_STORE_NAME);
    const data = await store.get(BLOB_KEY, { type: "json" });

    if (!data) {
      // 아직 update-news가 한 번도 실행되지 않은 초기 상태
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=60",
        },
        body: JSON.stringify({
          lastUpdated: null,
          articleCount: 0,
          articles: [],
          notice: "아직 첫 자동 수집이 실행되지 않았습니다. 배포 가이드의 '수동으로 첫 실행하기' 단계를 참고하세요.",
        }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error("[get-news] 오류:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
