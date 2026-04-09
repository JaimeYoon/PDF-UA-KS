<?php defined('ABSPATH') || exit; ?>

<div id="wrd-app" class="wrd-dashboard">

    <!-- 헤더 -->
    <div class="wrd-header">
        <div class="wrd-header-left">
            <h2 class="wrd-title">팀 주간보고 대시보드</h2>
            <span class="wrd-week-badge" id="wrd-week-label">로딩 중...</span>
        </div>
        <div class="wrd-header-right">
            <select id="wrd-week-select" class="wrd-week-select">
                <option value="">이번 주</option>
            </select>
            <?php if (current_user_can('manage_options')): ?>
            <button id="wrd-sync-btn" class="wrd-btn wrd-btn-primary">🔄 동기화</button>
            <?php endif; ?>
            <span class="wrd-last-sync" id="wrd-last-sync"></span>
        </div>
    </div>

    <!-- 탭 -->
    <div class="wrd-tabs">
        <button class="wrd-tab active" data-tab="overview">팀 현황</button>
        <button class="wrd-tab" data-tab="members">팀원별 상세</button>
        <button class="wrd-tab" data-tab="ai-analysis">AI 분석</button>
    </div>

    <!-- 로딩 -->
    <div id="wrd-loading" class="wrd-loading">
        <div class="wrd-spinner"></div>
        <p>Confluence 보고 데이터를 불러오는 중...</p>
    </div>

    <!-- 에러 -->
    <div id="wrd-error" class="wrd-error" style="display:none;">
        <p id="wrd-error-msg"></p>
    </div>

    <!-- ═══ 탭: 팀 현황 ═══════════════════════════════════════════════════ -->
    <div class="wrd-tab-content active" id="tab-overview" style="display:none;">

        <!-- KPI 카드 -->
        <div class="wrd-kpi-grid" id="wrd-kpi-grid">
            <div class="wrd-kpi-card">
                <div class="wrd-kpi-icon">👥</div>
                <div class="wrd-kpi-value" id="kpi-total">-</div>
                <div class="wrd-kpi-label">제출 인원</div>
            </div>
            <div class="wrd-kpi-card">
                <div class="wrd-kpi-icon">📈</div>
                <div class="wrd-kpi-value" id="kpi-avg">-</div>
                <div class="wrd-kpi-label">평균 진척도</div>
                <div class="wrd-kpi-delta" id="kpi-avg-delta"></div>
            </div>
            <div class="wrd-kpi-card success">
                <div class="wrd-kpi-icon">✅</div>
                <div class="wrd-kpi-value" id="kpi-above80">-</div>
                <div class="wrd-kpi-label">80% 이상 달성</div>
            </div>
            <div class="wrd-kpi-card warning">
                <div class="wrd-kpi-icon">⚠️</div>
                <div class="wrd-kpi-value" id="kpi-issues">-</div>
                <div class="wrd-kpi-label">이슈 보고</div>
            </div>
        </div>

        <!-- 진척도 차트 -->
        <div class="wrd-chart-section">
            <div class="wrd-chart-card">
                <h3>팀원별 진척도 비교 <span class="wrd-chart-legend"><span class="dot prev"></span>지난주 <span class="dot curr"></span>이번주</span></h3>
                <div class="wrd-chart-wrap">
                    <canvas id="wrd-progress-chart"></canvas>
                </div>
            </div>
            <div class="wrd-chart-card">
                <h3>진척도 분포</h3>
                <div class="wrd-chart-wrap wrd-chart-wrap--small">
                    <canvas id="wrd-dist-chart"></canvas>
                </div>
            </div>
        </div>

        <!-- 팀원 진척도 리스트 -->
        <div class="wrd-progress-list" id="wrd-progress-list"></div>

        <!-- AI 팀 요약 -->
        <div class="wrd-ai-team-card" id="wrd-team-ai-card" style="display:none;">
            <div class="wrd-ai-header">
                <span class="wrd-ai-badge">AI</span>
                <h3>팀 종합 분석</h3>
                <span class="wrd-health-badge" id="wrd-health-badge"></span>
            </div>
            <p id="wrd-executive-summary"></p>
            <div class="wrd-two-col">
                <div>
                    <h4>🎯 주요 성과</h4>
                    <ul id="wrd-highlights-list"></ul>
                </div>
                <div>
                    <h4>🚨 리스크</h4>
                    <ul id="wrd-risks-list"></ul>
                </div>
            </div>
            <div id="wrd-actions-wrap" style="display:none;">
                <h4>📋 액션 아이템</h4>
                <ul id="wrd-actions-list"></ul>
            </div>
        </div>
    </div>

    <!-- ═══ 탭: 팀원별 상세 ════════════════════════════════════════════════ -->
    <div class="wrd-tab-content" id="tab-members" style="display:none;">
        <div class="wrd-members-grid" id="wrd-members-grid"></div>
    </div>

    <!-- ═══ 탭: AI 분석 ═══════════════════════════════════════════════════ -->
    <div class="wrd-tab-content" id="tab-ai-analysis" style="display:none;">
        <div class="wrd-ai-analysis-wrap">
            <p class="wrd-ai-hint">팀원 카드를 클릭하면 지난주 대비 AI 변화 분석을 볼 수 있습니다.</p>
            <div id="wrd-member-selector" class="wrd-member-pills"></div>
            <div id="wrd-ai-detail" class="wrd-ai-detail" style="display:none;"></div>
        </div>
    </div>

</div><!-- /#wrd-app -->

<!-- 팀원 상세 모달 -->
<div id="wrd-modal" class="wrd-modal-overlay" style="display:none;" role="dialog" aria-modal="true">
    <div class="wrd-modal">
        <button class="wrd-modal-close" id="wrd-modal-close" aria-label="닫기">✕</button>
        <div id="wrd-modal-content"></div>
    </div>
</div>
