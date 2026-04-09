<?php
defined('ABSPATH') || exit;

/**
 * WordPress REST API 엔드포인트
 * 대시보드 JS → WordPress DB 조회 및 MCP 동기화 트리거
 */
class WRD_API {

    public static function init(): void {
        add_action('rest_api_init', [self::class, 'register_routes']);
    }

    public static function register_routes(): void {
        $ns = 'weekly-report/v1';

        // 대시보드 데이터 조회
        register_rest_route($ns, '/dashboard', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'get_dashboard'],
            'permission_callback' => [self::class, 'check_read_permission'],
            'args'                => [
                'week' => ['sanitize_callback' => 'sanitize_text_field'],
            ],
        ]);

        // 팀원 개별 보고 조회
        register_rest_route($ns, '/member/(?P<author>[^/]+)', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'get_member_report'],
            'permission_callback' => [self::class, 'check_read_permission'],
        ]);

        // 사용 가능한 주 목록
        register_rest_route($ns, '/weeks', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'get_weeks'],
            'permission_callback' => [self::class, 'check_read_permission'],
        ]);

        // 수동 동기화 트리거 (관리자만)
        register_rest_route($ns, '/sync', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'trigger_sync'],
            'permission_callback' => [self::class, 'check_admin_permission'],
        ]);

        // MCP 서버 → WordPress 데이터 수신 엔드포인트 (API Key 인증)
        register_rest_route($ns, '/sync', [
            'methods'             => 'PUT',
            'callback'            => [self::class, 'receive_sync_data'],
            'permission_callback' => [self::class, 'check_mcp_key'],
        ]);

        // 헬스체크
        register_rest_route($ns, '/health', [
            'methods'             => '__return_true',
            'callback'            => fn() => rest_ensure_response(['status' => 'ok']),
            'permission_callback' => '__return_true',
        ]);
    }

    /** 대시보드 전체 데이터 반환 */
    public static function get_dashboard(WP_REST_Request $req): WP_REST_Response {
        $week_key = sanitize_text_field($req->get_param('week') ?? '');
        if (empty($week_key)) $week_key = WRD_DB::current_week_key();

        $reports      = WRD_DB::get_reports_by_week($week_key);
        $team_summary = WRD_DB::get_team_summary($week_key);
        $prev_reports = WRD_DB::get_reports_by_week(self::prev_week_key($week_key));
        $weeks        = WRD_DB::get_available_weeks();

        // 팀원별 진척도 차트 데이터
        $chart_labels   = [];
        $chart_current  = [];
        $chart_previous = [];

        foreach ($reports as $r) {
            $chart_labels[]  = $r['author'];
            $chart_current[] = $r['parsed_data']['overall_progress'] ?? 0;
        }

        foreach ($prev_reports as $r) {
            $chart_previous[] = $r['parsed_data']['overall_progress'] ?? 0;
        }

        return rest_ensure_response([
            'week_key'     => $week_key,
            'last_sync'    => get_option('wrd_last_sync', null),
            'reports'      => $reports,
            'team_summary' => $team_summary,
            'weeks'        => $weeks,
            'chart'        => [
                'labels'   => $chart_labels,
                'current'  => $chart_current,
                'previous' => $chart_previous,
            ],
        ]);
    }

    /** 팀원 개별 보고 조회 */
    public static function get_member_report(WP_REST_Request $req): WP_REST_Response {
        global $wpdb;
        $author   = sanitize_text_field(urldecode($req->get_param('author')));
        $week_key = sanitize_text_field($req->get_param('week') ?? WRD_DB::current_week_key());
        $table    = $wpdb->prefix . 'wrd_reports';

        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table WHERE author = %s AND week_key = %s LIMIT 1",
            $author, $week_key
        ), ARRAY_A);

        if (!$row) {
            return new WP_REST_Response(['error' => '보고를 찾을 수 없습니다.'], 404);
        }

        $row['parsed_data'] = $row['parsed_data'] ? json_decode($row['parsed_data'], true) : null;
        $row['diff_data']   = $row['diff_data']   ? json_decode($row['diff_data'],   true) : null;

        return rest_ensure_response($row);
    }

    /** 사용 가능한 주 목록 */
    public static function get_weeks(): WP_REST_Response {
        return rest_ensure_response(['weeks' => WRD_DB::get_available_weeks()]);
    }

    /** 수동 동기화 트리거 */
    public static function trigger_sync(): WP_REST_Response {
        $sync   = new WRD_Confluence_Sync();
        $result = $sync->run();
        return rest_ensure_response($result);
    }

    /** MCP 서버에서 데이터 수신 (PUT /sync) */
    public static function receive_sync_data(WP_REST_Request $req): WP_REST_Response {
        $body    = $req->get_json_params();
        $type    = $body['type']    ?? '';
        $payload = $body['payload'] ?? [];

        switch ($type) {
            case 'member_report':
                $week_key = WRD_DB::date_to_week_key($payload['lastModified'] ?? date('Y-m-d'));
                WRD_DB::upsert_report([
                    'confluence_id'  => $payload['id']           ?? '',
                    'author'         => $payload['author']        ?? '',
                    'title'          => $payload['title']         ?? '',
                    'week_key'       => $week_key,
                    'plain_text'     => $payload['plainText']     ?? '',
                    'html_content'   => $payload['html']          ?? '',
                    'confluence_url' => $payload['url']           ?? '',
                    'parsed_data'    => $payload['parsed']        ?? [],
                    'diff_data'      => $payload['diff']          ?? null,
                ]);
                break;

            case 'team_summary':
                WRD_DB::upsert_team_summary(WRD_DB::current_week_key(), $payload);
                break;

            case 'sync_time':
                update_option('wrd_last_sync', $payload['synced_at'] ?? current_time('mysql'));
                break;
        }

        return rest_ensure_response(['success' => true]);
    }

    // ── 권한 체크 ──────────────────────────────────────────────────────────

    public static function check_read_permission(): bool {
        // 로그인한 사용자 또는 공개 설정 시 허용
        if (get_option('wrd_public_dashboard', '0') === '1') return true;
        return is_user_logged_in();
    }

    public static function check_admin_permission(): bool {
        return current_user_can('manage_options');
    }

    public static function check_mcp_key(WP_REST_Request $req): bool {
        $stored_key = get_option('wrd_mcp_api_key', '');
        if (empty($stored_key)) return current_user_can('manage_options');
        return $req->get_header('X-Api-Key') === $stored_key;
    }

    // ── 유틸 ───────────────────────────────────────────────────────────────

    private static function prev_week_key(string $current): string {
        [$year, $week] = explode('-W', $current);
        $dt = new DateTime();
        $dt->setISODate((int) $year, (int) $week);
        $dt->modify('-1 week');
        return $dt->format('Y-\WW');
    }
}
