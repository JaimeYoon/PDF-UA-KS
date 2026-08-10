'use strict';

let historyChart = null;
let allReports = [];

// ── 유틸 ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtDate = s => s ? new Date(s).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const statusColor = s => ({ completed: '#10b981', in_progress: '#3b82f6', planned: '#94a3b8', blocked: '#ef4444' })[s] || '#94a3b8';
const statusLabel = s => ({ completed: '완료', in_progress: '진행중', planned: '예정', blocked: '블로킹' })[s] || s || '';
const progressColor = p => p >= 80 ? '#10b981' : p >= 50 ? '#f59e0b' : '#ef4444';
const riskColor = r => ({ low: '#10b981', medium: '#f59e0b', high: '#ef4444' })[r] || '#94a3b8';

// ── 데이터 로드 ───────────────────────────────────────────────
async function loadDashboard() {
  $('loading').style.display = 'flex';
  $('main').style.display = 'none';
  $('empty-state').style.display = 'none';

  const res = await fetch('/api/dashboard');
  const data = await res.json();

  $('loading').style.display = 'none';

  if (data.empty || !data.currentReport) {
    $('empty-state').style.display = 'flex';
    return;
  }

  $('main').style.display = 'block';
  $('sync-time').textContent = data.lastSync ? `마지막 동기화: ${fmtDate(data.lastSync)}` : '';

  renderOverview(data.currentReport);
  renderDiff(data.currentReport, data.previousReport);

  // 이력 탭은 별도 API
  loadHistory();
}

// ── 이번 주 현황 탭 ───────────────────────────────────────────
function renderOverview(report) {
  const p = report.parsed || {};
  const progress = p.overall_progress ?? 0;

  $('report-title').textContent = report.title;
  $('report-meta').textContent = report.lastModified ? `최종 수정: ${fmtDate(report.lastModified)}` : '';
  $('confluence-link').href = report.url || '#';
  $('report-summary').textContent = p.summary || '';
  $('overall-pct').textContent = `${progress}%`;

  // 원형 진척도
  const circumference = 2 * Math.PI * 50;
  const offset = circumference * (1 - progress / 100);
  const bar = $('circle-bar');
  bar.style.stroke = progressColor(progress);
  bar.setAttribute('stroke-dasharray', circumference);
  bar.setAttribute('stroke-dashoffset', offset);

  // 카테고리
  const cats = p.categories || [];
  $('categories').innerHTML = cats.length
    ? cats.map(c => {
        const cp = c.progress ?? 0;
        const tasks = (c.tasks || []).slice(0, 10);
        return `
          <div class="cat-card">
            <div class="cat-header">
              <span class="cat-name">${esc(c.name)}</span>
              <span class="cat-pct" style="color:${progressColor(cp)}">${cp}%</span>
            </div>
            <div class="cat-bar-wrap">
              <div class="cat-bar" style="width:${cp}%;background:${progressColor(cp)}"></div>
            </div>
            <ul class="cat-bullet-list">
              ${tasks.map(t => `
                <li class="cat-bullet-item">
                  <span class="bullet-dot" style="color:${statusColor(t.status)}">●</span>
                  <span class="bullet-text">${esc(t.detail || t.title)}</span>
                </li>
              `).join('')}
            </ul>
          </div>
        `;
      }).join('')
    : '<p class="empty-msg">카테고리 데이터가 없습니다.</p>';

  // 성과
  $('highlights').innerHTML = (p.highlights || []).length
    ? p.highlights.map(h => `<li>${esc(h)}</li>`).join('')
    : '<li class="empty-msg">없음</li>';

  // 이슈
  $('issues').innerHTML = (p.issues || []).length
    ? p.issues.map(i => `<li class="issue-item">${esc(i)}</li>`).join('')
    : '<li class="empty-msg">이슈 없음 ✅</li>';

  // 다음 계획
  $('next-plans').innerHTML = (p.next_plans || []).length
    ? p.next_plans.map(n => `<li>${esc(n)}</li>`).join('')
    : '<li class="empty-msg">없음</li>';
}

// ── 지난주 대비 변화 탭 ───────────────────────────────────────
function renderDiff(current, previous) {
  const d = current?.diff;
  const cp = current?.parsed;
  const pp = previous?.parsed;

  if (!d) {
    $('diff-content').innerHTML = '<div class="card"><p class="empty-msg">비교 데이터가 없습니다. 동기화를 다시 실행해주세요.</p></div>';
    return;
  }

  const delta = d.progress_delta ?? 0;
  const risk = d.risk || 'low';

  $('diff-content').innerHTML = `
    <!-- 요약 배너 -->
    <div class="diff-banner">
      <div class="diff-delta ${delta >= 0 ? 'up' : 'down'}">
        ${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}%
        <span class="diff-label">전주 대비 진척도</span>
      </div>
      <div class="diff-risk" style="background:${riskColor(risk)}20;color:${riskColor(risk)};border:1px solid ${riskColor(risk)}">
        리스크: ${risk.toUpperCase()}
      </div>
    </div>

    <!-- 진척도 비교 바 -->
    ${pp ? `
    <div class="card">
      <h3>📊 진척도 비교</h3>
      <div class="compare-row">
        <span class="compare-label">지난주 (${esc(previous?.title || '')})</span>
        <div class="compare-bar-wrap">
          <div class="compare-bar prev" style="width:${pp.overall_progress ?? 0}%"></div>
        </div>
        <span class="compare-pct">${pp.overall_progress ?? 0}%</span>
      </div>
      <div class="compare-row">
        <span class="compare-label">이번주 (${esc(current?.title || '')})</span>
        <div class="compare-bar-wrap">
          <div class="compare-bar curr" style="width:${cp?.overall_progress ?? 0}%;background:${progressColor(cp?.overall_progress ?? 0)}"></div>
        </div>
        <span class="compare-pct">${cp?.overall_progress ?? 0}%</span>
      </div>
    </div>
    ` : ''}

    <!-- AI 변화 요약 -->
    <div class="card ai-card">
      <div class="ai-badge-row">
        <span class="ai-badge">AI 분석</span>
        <h3>변화 요약</h3>
      </div>
      <p class="change-summary">${esc(d.summary || '')}</p>
    </div>

    <!-- 4분면 변화 -->
    <div class="four-grid">
      <div class="card">
        <h4>✅ 완료된 작업</h4>
        <ul>${(d.completed_items || []).map(i => `<li>${esc(i)}</li>`).join('') || '<li class="empty-msg">없음</li>'}</ul>
      </div>
      <div class="card">
        <h4>🆕 새로 시작</h4>
        <ul>${(d.new_items || []).map(i => `<li>${esc(i)}</li>`).join('') || '<li class="empty-msg">없음</li>'}</ul>
      </div>
      <div class="card">
        <h4>🔄 계속 진행중</h4>
        <ul>${(d.ongoing_items || []).map(i => `<li>${esc(i)}</li>`).join('') || '<li class="empty-msg">없음</li>'}</ul>
      </div>
      <div class="card">
        <h4>🚨 새 이슈</h4>
        <ul>${(d.new_issues || []).map(i => `<li class="issue-item">${esc(i)}</li>`).join('') || '<li class="empty-msg">없음</li>'}</ul>
      </div>
    </div>

    <!-- 팀장 코멘트 -->
    <div class="card manager-card">
      <h3>💬 팀장 참고 코멘트 <span class="ai-badge small">AI 생성</span></h3>
      <p>${esc(d.manager_comment || '')}</p>
      ${(d.resolved_issues || []).length > 0 ? `
        <div class="resolved">
          <strong>✅ 해결된 이슈:</strong>
          ${d.resolved_issues.map(i => `<span class="resolved-item">${esc(i)}</span>`).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

// ── 보고 이력 탭 ─────────────────────────────────────────────
async function loadHistory() {
  const res = await fetch('/api/reports');
  allReports = await res.json();

  // 차트
  const labels = [...allReports].reverse().map(r => r.title.replace('주간 업무 보고 ', ''));
  const progresses = [...allReports].reverse().map(r => r.progress ?? 0);

  if (historyChart) historyChart.destroy();
  const ctx = $('history-chart').getContext('2d');
  historyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '전체 진척도',
        data: progresses,
        borderColor: '#4f46e5',
        backgroundColor: 'rgba(79,70,229,0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 5,
        pointBackgroundColor: progresses.map(p => progressColor(p)),
      }],
    },
    options: {
      responsive: true,
      scales: { y: { min: 0, max: 100, ticks: { callback: v => v + '%' } } },
      plugins: { legend: { display: false } },
    },
  });

  // 목록
  $('history-list').innerHTML = allReports.map(r => `
    <div class="history-item" onclick="loadReportDetail('${r.id}')">
      <div class="history-left">
        <div class="history-title">${esc(r.title)}</div>
        <div class="history-date">${fmtDate(r.lastModified)}</div>
      </div>
      <div class="history-right">
        ${r.progress != null ? `
          <div class="history-bar-wrap">
            <div class="history-bar" style="width:${r.progress}%;background:${progressColor(r.progress)}"></div>
          </div>
          <span class="history-pct" style="color:${progressColor(r.progress)}">${r.progress}%</span>
        ` : '<span class="empty-msg">분석 전</span>'}
        <a href="${esc(r.url || '#')}" target="_blank" class="ext-link" onclick="event.stopPropagation()">↗</a>
      </div>
    </div>
  `).join('') || '<p class="empty-msg">이력이 없습니다.</p>';
}

async function loadReportDetail(id) {
  const res = await fetch(`/api/report/${id}`);
  const report = await res.json();
  // 이번 주 현황 탭으로 이동해서 해당 보고 표시
  switchTab('overview');
  renderOverview(report);
  $('report-title').textContent = report.title + ' (과거 보고)';
}

// ── 동기화 ────────────────────────────────────────────────────
async function triggerSync(btn) {
  btn.disabled = true;
  btn.textContent = '동기화 중...';
  try {
    const res = await fetch('/api/sync', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      await loadDashboard();
    } else if (data.skipped) {
      alert(`이미 최신 데이터입니다: ${data.title}`);
    } else {
      alert('동기화 실패: ' + data.error);
    }
  } catch (e) {
    alert('서버 오류: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 지금 동기화';
  }
}

// ── 탭 전환 ──────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = p.id === `tab-${name}` ? 'block' : 'none');
}

// ── 이벤트 바인딩 ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();

  $('sync-btn').addEventListener('click', e => triggerSync(e.currentTarget));
  const emptyBtn = $('sync-btn-empty');
  if (emptyBtn) emptyBtn.addEventListener('click', e => triggerSync(e.currentTarget));

  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
});
