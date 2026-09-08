/**
 * Upstash Redis(무료 티어)를 이용한 간단한 key-value 저장소 유틸.
 * Netlify Blobs 대신 사용합니다 (Vercel은 자체 KV를 없애고 Upstash/Neon 등
 * 외부 파트너 서비스를 쓰도록 안내하고 있습니다).
 *
 * Upstash REST API 문서: https://upstash.com/docs/redis/features/restapi
 *
 * 필요한 환경변수:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 * (Upstash 콘솔에서 Redis 데이터베이스를 만들면 자동으로 발급됩니다 — 무료 티어,
 *  카드 등록 불필요)
 */

function getConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 환경변수가 설정되어 있지 않습니다. " +
      "https://console.upstash.com 에서 Redis 데이터베이스를 만든 뒤 " +
      "Vercel > Project Settings > Environment Variables 에서 등록해 주세요."
    );
  }
  return { url, token };
}

/** 저장된 값을 읽어옵니다. 없으면 null을 반환합니다 (JSON으로 파싱해서 반환). */
async function getJSON(key) {
  const { url, token } = getConfig();
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Upstash GET 오류 (${res.status})`);
  const data = await res.json();
  if (data.result == null) return null;
  try {
    return JSON.parse(data.result);
  } catch {
    return null;
  }
}

/** 값을 JSON 문자열로 저장합니다. */
async function setJSON(key, value) {
  const { url, token } = getConfig();
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`Upstash SET 오류 (${res.status})`);
  return res.json();
}

/** 키를 삭제합니다. */
async function del(key) {
  const { url, token } = getConfig();
  const res = await fetch(`${url}/del/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Upstash DEL 오류 (${res.status})`);
  return res.json();
}

module.exports = { getJSON, setJSON, del };
