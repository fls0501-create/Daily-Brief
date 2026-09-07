/* ============================================================
   소비자보호 Daily Brief — 프론트엔드 로직
   - /.netlify/functions/get-news 에서 기사 JSON을 읽어와 렌더링
   - 디자인/컴포넌트 구조는 기존 정적 버전과 동일하게 유지
   ============================================================ */

const DATA_ENDPOINT = '/.netlify/functions/get-news';
const REFRESH_ENDPOINT = '/.netlify/functions/manual-update-news';

const CAT_LABEL = {
  "생보": "생명보험",
  "손보": "손해보험",
  "은행": "은행",
  "카드": "카드",
  "당국": "금융당국",
  "기타": "기타"
};
// 탭에 표시할 카테고리 순서 (전체 다음 순서)
const CAT_ORDER = ["생보", "손보", "은행", "카드", "당국", "기타"];

const state = {
  cat: "전체",
  query: "",
  articles: [],   // 서버에서 받아온 기사 배열
  lastUpdated: null,
  trendSummary: "", // 백엔드(Gemini)가 생성한 동향 요약
  status: "loading" // loading | ok | error
};

function pad(n){ return String(n).padStart(2, '0'); }

function formatMastDate(iso){
  if(!iso) return '-';
  const d = new Date(iso);
  const days = ['일','월','화','수','목','금','토'];
  return `${d.getFullYear()}. ${pad(d.getMonth()+1)}. ${pad(d.getDate())} (${days[d.getDay()]})`;
}

function formatUpdatedFull(iso){
  if(!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------------- 데이터 로드 ---------------- */

async function loadNews(){
  try{
    const res = await fetch(DATA_ENDPOINT, { cache: 'no-store' });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.articles = (data.articles || []).slice().sort((a,b) => b.date.localeCompare(a.date));
    state.lastUpdated = data.lastUpdated || null;
    state.trendSummary = data.trendSummary || "";
    state.status = "ok";
  }catch(err){
    console.error('뉴스 데이터를 불러오지 못했습니다:', err);
    state.status = "error";
  }
  renderAll();
}

/* ---------------- 렌더링 ---------------- */

function renderAll(){
  renderMasthead();
  renderYesterday();
  renderTrend();
  renderTabs();
  renderFeed();
  renderFooter();
  setArchiveExpanded(false, { silent: true });
}

function renderMasthead(){
  const mastDate = document.getElementById('mastDate');
  const now = new Date();
  mastDate.textContent = formatMastDate(now.toISOString());
}

function renderYesterday(){
  const wrap = document.getElementById('yesterdayList');
  const titleEl = document.getElementById('yesterdayTitle');

  if(state.status === 'error' && state.articles.length === 0){
    titleEl.textContent = '최신 업데이트';
    wrap.innerHTML = `<li class="pick-item"><div class="pick-bar crimson"></div><div><p class="pick-reason">기사 데이터를 불러오지 못했습니다. 잠시 후 새로고침 해주세요.</p></div></li>`;
    return;
  }
  if(state.articles.length === 0){
    titleEl.textContent = '최신 업데이트';
    wrap.innerHTML = `<li class="pick-item"><div class="pick-bar teal"></div><div><p class="pick-reason">아직 수집된 기사가 없습니다. 첫 자동 수집을 기다리고 있습니다.</p></div></li>`;
    return;
  }

  titleEl.textContent = `최신 업데이트 (${formatUpdatedFull(state.lastUpdated)})`;

  // 데이터상 가장 최근 두 날짜(=사실상 당일·전일) 기사만 표시
  const distinctDates = [...new Set(state.articles.map(a => a.date))];
  const latestDates = distinctDates.slice(0, 2);
  const list = state.articles.filter(a => latestDates.includes(a.date));

  wrap.innerHTML = list.map(a => `
    <li class="pick-item">
      <div class="pick-bar ${a.status || 'teal'}"></div>
      <div>
        <div class="pick-top">
          <div class="card-tags">
            <span class="cat-tag">${CAT_LABEL[a.sector] || a.sector}</span>
            <span class="status-tag ${a.status || 'teal'}">${a.statusLabel || ''}</span>
          </div>
          <span class="card-date">${a.date}</span>
        </div>
        <p class="pick-company">${escapeHtml(a.company)}</p>
        <p class="pick-title">${escapeHtml(a.title)}</p>
        ${renderFactsList(a)}
        ${renderInsightRows(a)}
        <div class="card-bottom">
          <span class="card-source">참고 출처 · ${escapeHtml(a.source || '')}</span>
          <a class="card-link" href="${a.url}" target="_blank" rel="noopener">원문 보기 →</a>
        </div>
      </div>
    </li>
  `).join('');
}

function renderTrend(){
  const el = document.getElementById('trendText');
  if(state.status === 'error'){
    el.innerHTML = `<p>최근 동향 요약을 불러오지 못했습니다.</p>`;
    return;
  }
  if(state.trendSummary){
    el.innerHTML = `<p>${escapeHtml(state.trendSummary)}</p>`;
    return;
  }
  if(state.articles.length === 0){
    el.innerHTML = `<p>아직 데이터가 충분히 쌓이지 않았습니다.</p>`;
    return;
  }
  // 백엔드 요약이 없을 때의 대체용 간단 요약 (카테고리별 건수 기반)
  const counts = {};
  state.articles.forEach(a => { counts[a.sector] = (counts[a.sector]||0) + 1; });
  const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,3)
    .map(([k,v]) => `${CAT_LABEL[k]||k} ${v}건`).join(', ');
  const warn = state.articles.filter(a => a.status === 'crimson').slice(0,1)[0];

  el.innerHTML = `
    <p>최근 수집된 기사는 ${top} 순으로 많았습니다.</p>
    ${warn ? `<p>가장 주의가 필요한 최근 이슈: <b>${escapeHtml(warn.company)}</b> — ${escapeHtml(warn.title)}</p>` : ''}
  `;
}

function renderTabs(){
  const counts = { "전체": state.articles.length };
  CAT_ORDER.forEach(c => counts[c] = 0);
  state.articles.forEach(a => { counts[a.sector] = (counts[a.sector]||0) + 1; });

  const cats = ["전체", ...CAT_ORDER.filter(c => counts[c] > 0)];
  const tabs = document.getElementById('tabs');
  tabs.classList.toggle('hidden', state.query.length > 0);
  tabs.innerHTML = cats.map(c => `
    <button class="tab-btn ${c===state.cat ? 'active':''}" data-cat="${c}">
      ${c==='전체' ? '전체' : CAT_LABEL[c]}<span class="tab-count">${counts[c]}</span>
    </button>
  `).join('') + `<span class="tabs-note mono">최신순 정렬</span>`;

  tabs.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      state.cat = btn.dataset.cat;
      renderTabs();
      renderFeed();
    });
  });
}

function matchesQuery(item, q){
  if(!q) return true;
  const haystack = [
    item.company, item.title, item.source,
    CAT_LABEL[item.sector] || item.sector,
    ...(item.facts||[]),
    item.consumerAngle || '',
    item.internalNote || ''
  ].join(' ').toLowerCase();
  return haystack.includes(q.toLowerCase());
}

function renderFactsList(a){
  if(!a.facts || a.facts.length === 0) return '';
  return `<ul class="facts">${a.facts.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`;
}

function renderInsightRows(a){
  let html = '';
  if(a.consumerAngle){
    html += `<div class="insight-row"><span class="insight-label">소비자보호 관점</span><p>${escapeHtml(a.consumerAngle)}</p></div>`;
  }
  if(a.internalNote){
    html += `<div class="insight-row note"><span class="insight-label">당사 참고</span><p>${escapeHtml(a.internalNote)}</p></div>`;
  }
  return html;
}

function renderFeed(){
  const feed = document.getElementById('feed');

  if(state.status === 'error' && state.articles.length === 0){
    feed.innerHTML = `<p class="state-msg error">기사 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>`;
    return;
  }
  if(state.status === 'loading'){
    feed.innerHTML = `<p class="state-msg">불러오는 중…</p>`;
    return;
  }

  const effectiveCat = state.query ? '전체' : state.cat;
  let list = effectiveCat === '전체' ? state.articles : state.articles.filter(a => a.sector === effectiveCat);
  list = list.filter(a => matchesQuery(a, state.query));

  if(list.length === 0){
    feed.innerHTML = `<p class="state-msg">검색 결과가 없습니다. 다른 검색어를 입력해 보세요.</p>`;
    return;
  }

  feed.innerHTML = list.map(a => `
    <article class="card">
      <div class="card-bar ${a.status || 'teal'}"></div>
      <div class="card-body">
        <div class="card-top">
          <div class="card-tags">
            <span class="cat-tag">${CAT_LABEL[a.sector] || a.sector}</span>
            <span class="status-tag ${a.status || 'teal'}">${a.statusLabel || ''}</span>
          </div>
          <span class="card-date">${a.date}</span>
        </div>
        <p class="card-company">${escapeHtml(a.company)}</p>
        <h3 class="card-title">${escapeHtml(a.title)}</h3>
        ${renderFactsList(a)}
        ${renderInsightRows(a)}
        <div class="card-bottom">
          <span class="card-source">참고 출처 · ${escapeHtml(a.source || '')}</span>
          <a class="card-link" href="${a.url}" target="_blank" rel="noopener">원문 보기 →</a>
        </div>
      </div>
    </article>
  `).join('');
}

function renderFooter(){
  const el = document.getElementById('footerUpdated');
  if(state.lastUpdated){
    el.textContent = `마지막 자동 갱신: ${formatUpdatedFull(state.lastUpdated)} (KST)`;
  }
}

function escapeHtml(str){
  if(str == null) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

/* ---------------- 접기/펼치기 ---------------- */

const archiveToggleBtn = document.getElementById('archiveToggle');
const archiveBody = document.getElementById('archiveBody');
const archiveLabel = document.getElementById('archiveToggleLabel');

function setArchiveExpanded(expanded, opts = {}){
  archiveBody.hidden = !expanded;
  archiveToggleBtn.classList.toggle('expanded', expanded);
  archiveLabel.textContent = expanded ? '접기' : `전체 기사 보기 (${state.articles.length}건)`;
}

archiveToggleBtn.addEventListener('click', ()=>{
  setArchiveExpanded(archiveBody.hidden);
});

document.getElementById('searchInput').addEventListener('input', (e)=>{
  state.query = e.target.value.trim();
  renderTabs();
  renderFeed();
  if(state.query){ setArchiveExpanded(true); }
});

/* ---------------- 새로고침 버튼 (실제 백엔드 재수집 트리거) ---------------- */

const refreshBtn = document.getElementById('refreshBtn');
const refreshLabel = document.getElementById('refreshLabel');

refreshBtn.addEventListener('click', async ()=>{
  refreshBtn.disabled = true;
  refreshBtn.classList.add('spinning');
  refreshLabel.textContent = '수집 중… (최대 1분)';

  try{
    const res = await fetch(REFRESH_ENDPOINT, { cache: 'no-store' });
    const data = await res.json();
    if(!res.ok || data.ok === false){
      throw new Error(data.error || ('HTTP ' + res.status));
    }
    refreshLabel.textContent = `완료 (신규 ${data.newThisRun}건)`;
    await loadNews(); // 방금 저장된 최신 데이터를 다시 불러와 화면 갱신
  }catch(err){
    console.error('수동 갱신 실패:', err);
    refreshLabel.textContent = '갱신 실패';
  }finally{
    refreshBtn.classList.remove('spinning');
    refreshBtn.disabled = false;
    setTimeout(()=>{ refreshLabel.textContent = '새로고침'; }, 3000);
  }
});

/* ---------------- 초기 실행 ---------------- */

loadNews();

// 페이지를 열어둔 채로 오래 있으면 10분마다 최신 데이터 재조회 (수집 자체는 아니고, 저장된 데이터 재확인)
setInterval(loadNews, 10 * 60 * 1000);
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible') loadNews();
});
