/**
 * manual-update-news.js
 * -------------------------------------------------------------
 * 화면의 "새로고침" 버튼이 호출하는 엔드포인트입니다.
 * 클릭하면 그 자리에서 바로 Google News 검색 + Gemini 요약을 실행해서
 * Netlify Blobs에 최신 데이터를 저장합니다 (보통 10~30초 소요).
 *
 * 스케줄 실행(매일 오전 7시)을 기다리지 않고 즉시 최신화하고 싶을 때 사용합니다.
 * 브라우저 주소창이나 curl로 직접 호출할 수도 있습니다:
 *   https://당신의사이트주소.netlify.app/.netlify/functions/manual-update-news?secret=여기에_MANUAL_UPDATE_SECRET_값
 *
 * 기존에 저장된 데이터를 전부 지우고 완전히 새로 시작하고 싶으면 reset=true 를 추가하세요:
 *   https://당신의사이트주소.netlify.app/.netlify/functions/manual-update-news?reset=true
 * (회사명 사전이나 업권 기준을 바꾼 뒤, 예전 기준으로 저장된 낡은 데이터를 완전히 정리하고 싶을 때 사용)
 *
 * MANUAL_UPDATE_SECRET 환경변수를 설정해두면, 그 값을 아는 사람만 실행할 수 있습니다.
 * (내부용 도구라면 설정하지 않아도 무방합니다. 설정하지 않으면 화면의 새로고침 버튼도
 *  별도 값 없이 그냥 잘 작동합니다.)
 * -------------------------------------------------------------
 */

const { runUpdate } = require("./update-news");

exports.handler = async (event) => {
  const requiredSecret = process.env.MANUAL_UPDATE_SECRET;
  if (requiredSecret) {
    const provided = event.queryStringParameters?.secret;
    if (provided !== requiredSecret) {
      return {
        statusCode: 401,
        body: JSON.stringify({ ok: false, error: "secret 파라미터가 올바르지 않습니다." }),
      };
    }
  }

  try {
    const reset = event.queryStringParameters?.reset === 'true';
    const payload = await runUpdate(event, reset);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(
        {
          ok: true,
          message: "수동 실행 완료",
          newThisRun: payload.newThisRun,
          totalArticles: payload.articleCount,
          lastUpdated: payload.lastUpdated,
        },
        null,
        2
      ),
    };
  } catch (err) {
    console.error("[manual-update-news] 오류:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: false, error: err.message }, null, 2),
    };
  }
};
