/* global WRD_Config, Chart */
'use strict';

(function () {
  const API = WRD_Config.apiBase;
  const NONCE = WRD_Config.nonce;
  const IS_ADMIN = WRD_Config.isAdmin === '1';

  let state = {
    week: '',
    data: null,
    progressChart: null,
    distChart: null,
  };

  // ── 유틸 ──────────────────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }
  function fmt(n) { return typeof n === 'number' ? n.toFixed(0) + '%' : '-'; }

  async function apiFetch(path, opts = {}) {
    const url = API + path;
    const res = await fetch(url, {
      headers: { 'X-WP-Nonce': NONCE, 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function showLoading(show) {
    el('wrd-loading').style.display = show ? 'flex' : 'none';
  }

  function showError(msg) {
    const errDiv = el('wrd-error');
    el('wrd-error-msg').textContent = msg;
    errDiv.style.display = 'block';
    showLoading(false);
    document.querySelectorAll('.wrd-tab-content').forEach(t => t.style.display = 'none');
  }

  function setTabVisible(show) {
    if (!show) return;
    const activeTab = document.querySelector('.wrd-tab.active')?.dataset.tab || 'overview';
    document.querySelectorAll('.wrd-tab-content').forEach(t => t.style.display = 'none');
    const panel = el('tab-' + activeTab);
    if (panel) panel.style.display = 'block';
  }

  // ── 데이터 로드 ───────────────────────────────────────────────────────────
  async function loadDashboard(weekKey = '') {
    showLoading(true);
    el('wrd-error').style.display = 'none';
    document.querySelectorAll('.wrd-tab-content').forEach(t => t.style.display = 'none');

    try {
      const params = weekKey ? `?week=${encodeURIComponent(weekKey)}` : '';
      const data = await apiFetch('/dashboard' + params);
      state.data = data;
      state.week = data.week_key;

      renderKPIs(data);
      renderWeekSelect(data.weeks, data.week_key);
      renderProgressList(data.reports, data.chart);
      renderCharts(data.chart);
      renderMembersGrid(data.reports);
      renderAITeamSummary(data.team_summary);
      renderMemberPills(data.reports);

      el('wrd-week-label').textContent = formatWeekKey(data.week_key);

      if (data.last_sync) {
        el('wrd-last-sync').textContent = '마지막 동기화: ' + new Date(data.last_sync).toLocaleString('ko-KR');
      }

      showLoading(false);
      setTabVisible(true);
    } catch (err) {
      showError('데이터 로드 실패: ' + err.message + ' — MCP 서버와 Confluence 연결을 확인하세요.');
    }
  }

  function formatWeekKey(wk) {
    if (!wk) return '';
    const [year, week] = wk.split('-W');
    return `${year}년 ${parseInt(week)}주차`;
  }

  // ── KPI 카드 ──────────────────────────────────────────────────────────────
  function renderKPIs(data) {
    const reports = data.reports || [];
    const progresses = reports.map(r => r.parsed_data?.overall_progress ?? 0);
    const avg = progresses.length ? Math.round(progresses.reduce((a, b) => a + b, 0) / progresses.length) : 0;
    const prevProgresses = data.chart?.previous || [];
    const prevAvg = prevProgresses.length ? Math.round(prevProgresses.reduce((a, b) => a + b, 0) / prevProgresses.length) : null;

    el('kpi-total').textContent = reports.length + '명';
    el('kpi-avg').textContent = avg + '%';
    el('kpi-above80').textContent = progresses.filter(p => p >= 80).length + '명';
    el('kpi-issues').textContent = reports.filter(r => (r.parsed_data?.issues?.length ?? 0) > 0).length + '건';

    if (prevAvg !== null) {
      const delta = avg - prevAvg;
      const deltaEl = el('kpi-avg-delta');
      deltaEl.textContent = (delta >= 0 ? '▲' : '▼') + Math.abs(delta) + '%';
      deltaEl.className = 'wrd-kpi-delta ' + (delta >= 0 ? 'positive' : 'negative');
    }
  }

  // ── 주 선택 셀렉트 ────────────────────────────────────────────────────────
  function renderWeekSelect(weeks, currentWeek) {
    const sel = el('wrd-week-select');
    sel.innerHTML = '<option value="">이번 주</option>';
    (weeks || []).forEach(wk => {
      const opt = document.createElement('option');
      opt.value = wk;
      opt.textContent = formatWeekKey(wk);
      if (wk === currentWeek) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  // ── 진척도 리스트 ─────────────────────────────────────────────────────────
  function renderProgressList(reports, chart) {
    const container = el('wrd-progress-list');
    const prevMap = {};
    (chart?.labels || []).forEach((label, i) => {
      prevMap[label] = chart.previous?.[i] ?? null;
    });

    container.innerHTML = reports.map(r => {
      const p = r.parsed_data;
      const progress = p?.overall_progress ?? 0;
      const prev = prevMap[r.author] ?? null;
      const delta = prev !== null ? progress - prev : null;
      const sentiment = p?.sentiment || 'neutral';
      const issues = p?.issues?.length ?? 0;
      const color = progress >= 80 ? '#10b981' : progress >= 50 ? '#f59e0b' : '#ef4444';

      return `
        <div class="wrd-progress-item" data-author="${escHtml(r.author)}">
          <div class="wrd-progress-header">
            <span class="wrd-author-name">${escHtml(r.author)}</span>
            <div class="wrd-progress-meta">
              ${delta !== null ? `<span class="wrd-delta ${delta >= 0 ? 'positive' : 'negative'}">${delta >= 0 ? '▲' : '▼'}${Math.abs(delta)}%</span>` : ''}
              <span class="wrd-sentiment wrd-sentiment--${sentiment}">${sentimentIcon(sentiment)}</span>
              ${issues > 0 ? `<span class="wrd-issue-badge">이슈 ${issues}건</span>` : ''}
              <span class="wrd-progress-pct">${progress}%</span>
            </div>
          </div>
          <div class="wrd-progress-bar-wrap">
            <div class="wrd-progress-bar" style="width:${progress}%; background:${color};">
              ${prev !== null ? `<div class="wrd-progress-prev-marker" style="left:${prev}%;" title="지난주: ${prev}%"></div>` : ''}
            </div>
          </div>
          ${p?.summary ? `<p class="wrd-progress-summary">${escHtml(p.summary.substring(0, 120))}${p.summary.length > 120 ? '...' : ''}</p>` : ''}
        </div>
      `;
    }).join('') || '<p class="wrd-empty">이번 주 제출된 보고가 없습니다.</p>';
  }

  // ── 차트 ─────────────────────────────────────────────────────────────────
  function renderCharts(chart) {
    const labels   = chart?.labels   || [];
    const current  = chart?.current  || [];
    const previous = chart?.previous || [];

    // 막대 차트
    if (state.progressChart) state.progressChart.destroy();
    const ctx1 = el('wrd-progress-chart').getContext('2d');
    state.progressChart = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '지난주',
            data: previous,
            backgroundColor: 'rgba(148, 163, 184, 0.5)',
            borderColor: 'rgba(148, 163, 184, 0.8)',
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: '이번주',
            data: current,
            backgroundColor: current.map(v =>
              v >= 80 ? 'rgba(16, 185, 129, 0.8)' :
              v >= 50 ? 'rgba(245, 158, 11, 0.8)' :
              'rgba(239, 68, 68, 0.8)'
            ),
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { min: 0, max: 100, ticks: { callback: v => v + '%' } },
        },
        plugins: { legend: { position: 'top' } },
      },
    });

    // 분포 도넛 차트
    if (state.distChart) state.distChart.destroy();
    const buckets = [0, 0, 0, 0]; // <25, 25-50, 50-80, 80+
    current.forEach(v => {
      if (v < 25) buckets[0]++;
      else if (v < 50) buckets[1]++;
      else if (v < 80) buckets[2]++;
      else buckets[3]++;
    });
    const ctx2 = el('wrd-dist-chart').getContext('2d');
    state.distChart = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: ['25% 미만', '25~50%', '50~80%', '80% 이상'],
        datasets: [{
          data: buckets,
          backgroundColor: ['#ef4444', '#f97316', '#f59e0b', '#10b981'],
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
      },
    });
  }

  // ── 팀원 카드 그리드 ──────────────────────────────────────────────────────
  function renderMembersGrid(reports) {
    const grid = el('wrd-members-grid');
    grid.innerHTML = reports.map(r => {
      const p = r.parsed_data;
      const d = r.diff_data;
      const progress = p?.overall_progress ?? 0;
      const color = progress >= 80 ? '#10b981' : progress >= 50 ? '#f59e0b' : '#ef4444';

      const taskBadges = (p?.tasks || []).slice(0, 4).map(t => `
        <span class="wrd-task-badge wrd-task-badge--${t.status || 'unknown'}">
          ${escHtml(t.title?.substring(0, 20) || '')} ${t.progress != null ? `(${t.progress}%)` : ''}
        </span>
      `).join('');

      return `
        <div class="wrd-member-card" data-author="${escHtml(r.author)}" tabindex="0" role="button">
          <div class="wrd-member-card-header">
            <div class="wrd-member-avatar">${r.author?.charAt(0) || '?'}</div>
            <div>
              <div class="wrd-member-name">${escHtml(r.author)}</div>
              <div class="wrd-member-date">${r.report_date || ''}</div>
            </div>
            <div class="wrd-member-progress-num" style="color:${color}">${progress}%</div>
          </div>

          <!-- 원형 진척도 -->
          <div class="wrd-circle-progress-wrap">
            <svg class="wrd-circle-progress" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="34" fill="none" stroke="#e5e7eb" stroke-width="8"/>
              <circle cx="40" cy="40" r="34" fill="none" stroke="${color}" stroke-width="8"
                stroke-dasharray="${2 * Math.PI * 34}"
                stroke-dashoffset="${2 * Math.PI * 34 * (1 - progress / 100)}"
                stroke-linecap="round" transform="rotate(-90 40 40)"/>
            </svg>
            <span class="wrd-circle-label">${progress}%</span>
          </div>

          ${taskBadges ? `<div class="wrd-task-badges">${taskBadges}</div>` : ''}

          ${(p?.highlights || []).length > 0 ? `
            <div class="wrd-member-highlights">
              <strong>✅ 성과:</strong>
              <ul>${p.highlights.slice(0, 2).map(h => `<li>${escHtml(h)}</li>`).join('')}</ul>
            </div>
          ` : ''}

          ${(p?.issues || []).length > 0 ? `
            <div class="wrd-member-issues">
              <strong>⚠️ 이슈:</strong>
              <ul>${p.issues.slice(0, 2).map(i => `<li>${escHtml(i)}</li>`).join('')}</ul>
            </div>
          ` : ''}

          ${d ? `
            <div class="wrd-diff-summary">
              <span class="wrd-delta ${(d.progress_change ?? 0) >= 0 ? 'positive' : 'negative'}">
                ${(d.progress_change ?? 0) >= 0 ? '▲' : '▼'} 전주 대비 ${Math.abs(d.progress_change ?? 0)}%
              </span>
              ${d.risk_level === 'high' ? '<span class="wrd-risk-badge">🔴 High Risk</span>' : ''}
              ${d.risk_level === 'medium' ? '<span class="wrd-risk-badge medium">🟡 Medium</span>' : ''}
            </div>
          ` : ''}

          <a href="${escHtml(r.confluence_url || '#')}" target="_blank" class="wrd-confluence-link" rel="noopener">
            Confluence에서 보기 →
          </a>
        </div>
      `;
    }).join('') || '<p class="wrd-empty">팀원 보고가 없습니다.</p>';
  }

  // ── AI 팀 요약 ────────────────────────────────────────────────────────────
  function renderAITeamSummary(teamSummary) {
    const card = el('wrd-team-ai-card');
    if (!teamSummary?.summary_data) { card.style.display = 'none'; return; }

    const s = teamSummary.summary_data;
    card.style.display = 'block';

    const healthColor = { excellent: '#10b981', good: '#3b82f6', fair: '#f59e0b', poor: '#ef4444' };
    const healthLabel = { excellent: '매우 좋음', good: '좋음', fair: '보통', poor: '주의 필요' };

    el('wrd-executive-summary').textContent = s.executive_summary || '';
    const badge = el('wrd-health-badge');
    badge.textContent = healthLabel[s.team_health] || s.team_health;
    badge.style.background = healthColor[s.team_health] || '#6b7280';

    el('wrd-highlights-list').innerHTML = (s.team_highlights || []).map(h => `<li>${escHtml(h)}</li>`).join('') || '<li>없음</li>';
    el('wrd-risks-list').innerHTML = (s.top_risks || []).map(r => `<li>${escHtml(r)}</li>`).join('') || '<li>없음</li>';

    const actionsWrap = el('wrd-actions-wrap');
    if ((s.action_items || []).length > 0) {
      el('wrd-actions-list').innerHTML = s.action_items.map(a => `<li>${escHtml(a)}</li>`).join('');
      actionsWrap.style.display = 'block';
    } else {
      actionsWrap.style.display = 'none';
    }
  }

  // ── AI 분석 탭: 팀원 필 ───────────────────────────────────────────────────
  function renderMemberPills(reports) {
    const container = el('wrd-member-selector');
    container.innerHTML = reports.map(r => `
      <button class="wrd-pill" data-author="${escHtml(r.author)}">${escHtml(r.author)}</button>
    `).join('');
  }

  function renderAIDetail(report) {
    const detail = el('wrd-ai-detail');
    const d = report.diff_data;
    const p = report.parsed_data;

    detail.style.display = 'block';
    detail.innerHTML = `
      <div class="wrd-ai-detail-card">
        <div class="wrd-ai-detail-header">
          <div class="wrd-member-avatar large">${report.author?.charAt(0) || '?'}</div>
          <div>
            <h3>${escHtml(report.author)}</h3>
            <p>${escHtml(p?.summary || '')}</p>
          </div>
        </div>

        ${d ? `
          <div class="wrd-ai-change-summary">
            <h4>📊 지난주 대비 변화</h4>
            <p class="wrd-change-text">${escHtml(d.change_summary || '')}</p>
            <div class="wrd-change-grid">
              <div>
                <h5>✅ 완료된 작업</h5>
                <ul>${(d.completed_tasks || []).map(t => `<li>${escHtml(t)}</li>`).join('') || '<li>없음</li>'}</ul>
              </div>
              <div>
                <h5>🆕 새로 시작</h5>
                <ul>${(d.new_tasks || []).map(t => `<li>${escHtml(t)}</li>`).join('') || '<li>없음</li>'}</ul>
              </div>
              <div>
                <h5>🔄 계속 진행</h5>
                <ul>${(d.still_in_progress || []).map(t => `<li>${escHtml(t)}</li>`).join('') || '<li>없음</li>'}</ul>
              </div>
              <div>
                <h5>🚨 새 이슈</h5>
                <ul>${(d.new_issues || []).map(i => `<li>${escHtml(i)}</li>`).join('') || '<li>없음</li>'}</ul>
              </div>
            </div>
          </div>
          <div class="wrd-manager-comment">
            <h4>💬 매니저 코멘트 (AI 생성)</h4>
            <p>${escHtml(d.manager_comment || '')}</p>
            ${d.recommendation ? `<div class="wrd-recommendation"><strong>추천:</strong> ${escHtml(d.recommendation)}</div>` : ''}
          </div>
        ` : '<p class="wrd-empty">지난주 데이터가 없어 비교 분석을 제공할 수 없습니다.</p>'}

        <div class="wrd-tasks-section">
          <h4>📋 작업 목록</h4>
          ${(p?.tasks || []).map(t => `
            <div class="wrd-task-row">
              <span class="wrd-task-status wrd-task-status--${t.status}">${taskStatusLabel(t.status)}</span>
              <span class="wrd-task-title">${escHtml(t.title || '')}</span>
              <div class="wrd-task-progress-bar-wrap">
                <div class="wrd-task-progress-bar" style="width:${t.progress || 0}%"></div>
              </div>
              <span class="wrd-task-pct">${t.progress ?? 0}%</span>
            </div>
          `).join('') || '<p class="wrd-empty">작업 없음</p>'}
        </div>

        <div class="wrd-next-plans">
          <h4>📅 다음주 계획</h4>
          <ul>${(p?.next_week_plan || []).map(n => `<li>${escHtml(n)}</li>`).join('') || '<li>없음</li>'}</ul>
        </div>
      </div>
    `;
  }

  // ── 이벤트 바인딩 ─────────────────────────────────────────────────────────
  function bindEvents() {
    // 탭 전환
    document.querySelectorAll('.wrd-tab').forEach(btn => {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.wrd-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.wrd-tab-content').forEach(t => t.style.display = 'none');
        this.classList.add('active');
        const panel = el('tab-' + this.dataset.tab);
        if (panel) panel.style.display = 'block';
      });
    });

    // 주 선택
    el('wrd-week-select').addEventListener('change', function () {
      loadDashboard(this.value);
    });

    // 동기화 버튼 (관리자)
    if (IS_ADMIN) {
      const syncBtn = el('wrd-sync-btn');
      if (syncBtn) {
        syncBtn.addEventListener('click', async function () {
          this.textContent = '동기화 중...';
          this.disabled = true;
          try {
            await apiFetch('/sync', { method: 'POST' });
            await loadDashboard(state.week);
          } catch (err) {
            alert('동기화 실패: ' + err.message);
          } finally {
            this.textContent = '🔄 동기화';
            this.disabled = false;
          }
        });
      }
    }

    // 팀원 카드 클릭 → 모달
    document.addEventListener('click', function (e) {
      const card = e.target.closest('.wrd-member-card');
      if (card && !e.target.closest('.wrd-confluence-link')) {
        const author = card.dataset.author;
        const report = (state.data?.reports || []).find(r => r.author === author);
        if (report) openModal(report);
      }

      // AI 분석 탭 팀원 필 클릭
      const pill = e.target.closest('.wrd-pill');
      if (pill) {
        document.querySelectorAll('.wrd-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const author = pill.dataset.author;
        const report = (state.data?.reports || []).find(r => r.author === author);
        if (report) renderAIDetail(report);
      }
    });

    // 모달 닫기
    el('wrd-modal-close').addEventListener('click', closeModal);
    el('wrd-modal').addEventListener('click', function (e) {
      if (e.target === this) closeModal();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  }

  function openModal(report) {
    const modal = el('wrd-modal');
    const content = el('wrd-modal-content');
    const p = report.parsed_data;
    const d = report.diff_data;

    content.innerHTML = `
      <div class="wrd-modal-header">
        <div class="wrd-member-avatar large">${report.author?.charAt(0) || '?'}</div>
        <div>
          <h2>${escHtml(report.author)}</h2>
          <span>${escHtml(report.title || '')}</span>
          <a href="${escHtml(report.confluence_url || '#')}" target="_blank" rel="noopener" class="wrd-confluence-link">Confluence →</a>
        </div>
      </div>

      <div class="wrd-modal-summary">${escHtml(p?.summary || '요약 없음')}</div>

      ${d?.manager_comment ? `
        <div class="wrd-manager-comment">
          <strong>💬 AI 매니저 코멘트:</strong>
          <p>${escHtml(d.manager_comment)}</p>
          <p class="wrd-change-text">${escHtml(d.change_summary || '')}</p>
        </div>
      ` : ''}

      <div class="wrd-modal-two-col">
        <div>
          <h4>✅ 주요 성과</h4>
          <ul>${(p?.highlights || []).map(h => `<li>${escHtml(h)}</li>`).join('') || '<li>없음</li>'}</ul>
          <h4>📅 다음주 계획</h4>
          <ul>${(p?.next_week_plan || []).map(n => `<li>${escHtml(n)}</li>`).join('') || '<li>없음</li>'}</ul>
        </div>
        <div>
          <h4>⚠️ 이슈</h4>
          <ul>${(p?.issues || []).map(i => `<li>${escHtml(i)}</li>`).join('') || '<li>없음</li>'}</ul>
          <h4>🏷 키워드</h4>
          <div class="wrd-keywords">${(p?.keywords || []).map(k => `<span class="wrd-keyword">${escHtml(k)}</span>`).join('')}</div>
        </div>
      </div>

      <div class="wrd-modal-tasks">
        <h4>📋 작업 현황</h4>
        ${(p?.tasks || []).map(t => `
          <div class="wrd-task-row">
            <span class="wrd-task-status wrd-task-status--${t.status}">${taskStatusLabel(t.status)}</span>
            <span class="wrd-task-title">${escHtml(t.title || '')}</span>
            <div class="wrd-task-progress-bar-wrap">
              <div class="wrd-task-progress-bar" style="width:${t.progress || 0}%"></div>
            </div>
            <span class="wrd-task-pct">${t.progress ?? 0}%</span>
          </div>
        `).join('') || '<p>작업 없음</p>'}
      </div>
    `;

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    el('wrd-modal').style.display = 'none';
    document.body.style.overflow = '';
  }

  // ── 헬퍼 ─────────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function sentimentIcon(s) {
    return s === 'positive' ? '😊' : s === 'negative' ? '😟' : '😐';
  }

  function taskStatusLabel(s) {
    const map = { completed: '완료', in_progress: '진행중', blocked: '블로킹', planned: '예정' };
    return map[s] || s || '';
  }

  // ── 초기화 ────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    bindEvents();
    loadDashboard();
  });

})();
