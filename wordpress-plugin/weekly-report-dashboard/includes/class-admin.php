<?php
defined('ABSPATH') || exit;

class WRD_Admin {

    public static function init(): void {
        add_action('admin_menu',           [self::class, 'add_menu']);
        add_action('admin_init',           [self::class, 'register_settings']);
        add_action('admin_post_wrd_sync',  [self::class, 'handle_manual_sync']);
        add_action('admin_enqueue_scripts',[self::class, 'enqueue_assets']);
        add_filter('plugin_action_links_' . plugin_basename(WRD_PLUGIN_DIR . 'weekly-report-dashboard.php'),
                   [self::class, 'plugin_links']);
    }

    public static function deactivate(): void {
        wp_clear_scheduled_hook('wrd_auto_sync');
    }

    public static function add_menu(): void {
        add_menu_page(
            '주간보고 대시보드',
            '주간보고',
            'manage_options',
            'wrd-dashboard',
            [self::class, 'render_admin_page'],
            'dashicons-chart-bar',
            30
        );
        add_submenu_page('wrd-dashboard', '설정', '설정', 'manage_options', 'wrd-settings', [self::class, 'render_settings_page']);
        add_submenu_page('wrd-dashboard', '동기화 로그', '동기화 로그', 'manage_options', 'wrd-logs', [self::class, 'render_logs_page']);
    }

    public static function enqueue_assets(string $hook): void {
        if (!in_array($hook, ['toplevel_page_wrd-dashboard', 'wrd_page_wrd-settings', 'wrd_page_wrd-logs'], true)) return;
        wp_enqueue_style('wrd-admin', WRD_PLUGIN_URL . 'assets/admin.css', [], WRD_VERSION);
    }

    public static function register_settings(): void {
        $fields = [
            'wrd_mcp_url'         => ['label' => 'MCP 서버 URL', 'default' => 'http://localhost:3456'],
            'wrd_mcp_api_key'     => ['label' => 'MCP API Key', 'default' => ''],
            'wrd_confluence_space'=> ['label' => 'Confluence Space Key', 'default' => ''],
            'wrd_title_pattern'   => ['label' => '보고 제목 패턴', 'default' => '주간보고'],
            'wrd_sync_interval'   => ['label' => '자동 동기화 주기', 'default' => 'wrd_every_hour'],
            'wrd_public_dashboard'=> ['label' => '공개 대시보드', 'default' => '0'],
        ];

        register_setting('wrd_options', 'wrd_options', [
            'sanitize_callback' => [self::class, 'sanitize_options'],
        ]);

        foreach ($fields as $key => $info) {
            register_setting('wrd_settings', $key, ['default' => $info['default']]);
        }
    }

    public static function sanitize_options(array $input): array {
        return array_map('sanitize_text_field', $input);
    }

    public static function handle_manual_sync(): void {
        check_admin_referer('wrd_manual_sync');
        if (!current_user_can('manage_options')) wp_die('권한 없음');

        $sync   = new WRD_Confluence_Sync();
        $result = $sync->run();

        $status = $result['success'] ? 'success' : 'error';
        $msg    = $result['success']
            ? urlencode("동기화 완료: {$result['synced']}건")
            : urlencode('동기화 실패: ' . ($result['message'] ?? '알 수 없음'));

        wp_redirect(admin_url("admin.php?page=wrd-dashboard&wrd_sync={$status}&msg={$msg}"));
        exit;
    }

    public static function plugin_links(array $links): array {
        array_unshift($links, '<a href="' . admin_url('admin.php?page=wrd-settings') . '">설정</a>');
        return $links;
    }

    // ── 관리자 페이지 렌더 ─────────────────────────────────────────────────

    public static function render_admin_page(): void {
        $last_sync = get_option('wrd_last_sync', '없음');
        $status    = sanitize_text_field($_GET['wrd_sync'] ?? '');
        $msg       = sanitize_text_field(urldecode($_GET['msg'] ?? ''));
        ?>
        <div class="wrap wrd-admin-wrap">
            <h1>주간보고 대시보드 <span class="version">v<?= WRD_VERSION ?></span></h1>

            <?php if ($status === 'success'): ?>
                <div class="notice notice-success"><p>✅ <?= esc_html($msg) ?></p></div>
            <?php elseif ($status === 'error'): ?>
                <div class="notice notice-error"><p>❌ <?= esc_html($msg) ?></p></div>
            <?php endif; ?>

            <div class="wrd-meta-bar">
                <span>마지막 동기화: <strong><?= esc_html($last_sync) ?></strong></span>
                <form method="post" action="<?= admin_url('admin-post.php') ?>" style="display:inline;">
                    <input type="hidden" name="action" value="wrd_sync">
                    <?php wp_nonce_field('wrd_manual_sync') ?>
                    <button class="button button-primary" type="submit">🔄 지금 동기화</button>
                </form>
            </div>

            <div class="wrd-shortcode-hint">
                <code>[weekly_report_dashboard]</code> 쇼트코드를 원하는 페이지에 삽입하면 대시보드가 표시됩니다.
            </div>

            <!-- 미리보기: 이번 주 현황 요약 -->
            <?php
            $reports      = WRD_DB::get_current_week_reports();
            $team_summary = WRD_DB::get_team_summary();
            $avg_progress = 0;
            if (!empty($reports)) {
                $avg_progress = round(array_sum(array_map(fn($r) => $r['parsed_data']['overall_progress'] ?? 0, $reports)) / count($reports));
            }
            ?>
            <div class="wrd-stats-grid">
                <div class="wrd-stat-card">
                    <div class="wrd-stat-number"><?= count($reports) ?>명</div>
                    <div class="wrd-stat-label">제출 완료</div>
                </div>
                <div class="wrd-stat-card">
                    <div class="wrd-stat-number"><?= $avg_progress ?>%</div>
                    <div class="wrd-stat-label">평균 진척도</div>
                </div>
                <div class="wrd-stat-card">
                    <div class="wrd-stat-number"><?= count(array_filter($reports, fn($r) => ($r['parsed_data']['overall_progress'] ?? 0) >= 80)) ?>명</div>
                    <div class="wrd-stat-label">80% 이상 달성</div>
                </div>
                <div class="wrd-stat-card risk">
                    <div class="wrd-stat-number"><?= count(array_filter($reports, fn($r) => !empty($r['parsed_data']['issues']))) ?>건</div>
                    <div class="wrd-stat-label">이슈 보고</div>
                </div>
            </div>

            <?php if ($team_summary && !empty($team_summary['summary_data']['executive_summary'])): ?>
            <div class="wrd-ai-summary">
                <h3>🤖 AI 팀 요약</h3>
                <p><?= esc_html($team_summary['summary_data']['executive_summary']) ?></p>
                <?php if (!empty($team_summary['summary_data']['action_items'])): ?>
                <ul>
                    <?php foreach ($team_summary['summary_data']['action_items'] as $item): ?>
                        <li><?= esc_html($item) ?></li>
                    <?php endforeach; ?>
                </ul>
                <?php endif; ?>
            </div>
            <?php endif; ?>
        </div>
        <?php
    }

    public static function render_settings_page(): void {
        ?>
        <div class="wrap">
            <h1>주간보고 대시보드 설정</h1>
            <form method="post" action="options.php">
                <?php settings_fields('wrd_settings') ?>
                <table class="form-table">
                    <tr>
                        <th>MCP 서버 URL</th>
                        <td>
                            <input type="url" name="wrd_mcp_url" value="<?= esc_attr(get_option('wrd_mcp_url', 'http://localhost:3456')) ?>" class="regular-text">
                            <p class="description">Node.js MCP 서버 주소 (같은 NAS에서 실행 시 localhost 사용)</p>
                        </td>
                    </tr>
                    <tr>
                        <th>MCP API Key</th>
                        <td>
                            <input type="password" name="wrd_mcp_api_key" value="<?= esc_attr(get_option('wrd_mcp_api_key', '')) ?>" class="regular-text">
                            <p class="description">MCP 서버 .env의 MCP_API_KEY와 동일하게 설정</p>
                        </td>
                    </tr>
                    <tr>
                        <th>Confluence Space Key</th>
                        <td>
                            <input type="text" name="wrd_confluence_space" value="<?= esc_attr(get_option('wrd_confluence_space', '')) ?>" class="regular-text" placeholder="WEEKLY">
                        </td>
                    </tr>
                    <tr>
                        <th>보고 제목 패턴</th>
                        <td>
                            <input type="text" name="wrd_title_pattern" value="<?= esc_attr(get_option('wrd_title_pattern', '주간보고')) ?>" class="regular-text">
                            <p class="description">Confluence 페이지 제목에서 검색할 키워드</p>
                        </td>
                    </tr>
                    <tr>
                        <th>자동 동기화 주기</th>
                        <td>
                            <select name="wrd_sync_interval">
                                <?php
                                $saved = get_option('wrd_sync_interval', 'wrd_every_hour');
                                $options = [
                                    'wrd_every_30min' => '30분마다',
                                    'wrd_every_hour'  => '매 시간',
                                    'twicedaily'      => '하루 2회',
                                    'daily'           => '매일',
                                ];
                                foreach ($options as $val => $label):
                                ?>
                                    <option value="<?= $val ?>" <?= selected($saved, $val, false) ?>><?= $label ?></option>
                                <?php endforeach; ?>
                            </select>
                        </td>
                    </tr>
                    <tr>
                        <th>공개 대시보드</th>
                        <td>
                            <label>
                                <input type="checkbox" name="wrd_public_dashboard" value="1" <?= checked(get_option('wrd_public_dashboard', '0'), '1', false) ?>>
                                로그인 없이 대시보드 열람 허용
                            </label>
                        </td>
                    </tr>
                </table>
                <?php submit_button('설정 저장') ?>
            </form>
        </div>
        <?php
    }

    public static function render_logs_page(): void {
        global $wpdb;
        $logs = $wpdb->get_results(
            "SELECT * FROM {$wpdb->prefix}wrd_sync_log ORDER BY created_at DESC LIMIT 50",
            ARRAY_A
        );
        ?>
        <div class="wrap">
            <h1>동기화 로그</h1>
            <table class="widefat striped">
                <thead><tr><th>시각</th><th>상태</th><th>건수</th><th>메시지</th></tr></thead>
                <tbody>
                <?php foreach ($logs as $log): ?>
                    <tr>
                        <td><?= esc_html($log['created_at']) ?></td>
                        <td><span class="wrd-status-<?= esc_attr($log['status']) ?>"><?= esc_html($log['status']) ?></span></td>
                        <td><?= (int) $log['synced_cnt'] ?>건</td>
                        <td><?= esc_html($log['message']) ?></td>
                    </tr>
                <?php endforeach; ?>
                <?php if (empty($logs)): ?>
                    <tr><td colspan="4">동기화 기록이 없습니다.</td></tr>
                <?php endif; ?>
                </tbody>
            </table>
        </div>
        <?php
    }
}
