<?php
defined('ABSPATH') || exit;

class WRD_DB {

    /** 플러그인 활성화 시 테이블 생성 */
    public static function install(): void {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();

        // 팀원별 주간보고 원본 + 분석 결과
        $sql1 = "CREATE TABLE IF NOT EXISTS {$wpdb->prefix}wrd_reports (
            id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            confluence_id VARCHAR(64)     NOT NULL,
            author        VARCHAR(255)    NOT NULL DEFAULT '',
            title         VARCHAR(500)    NOT NULL DEFAULT '',
            report_date   DATE            NULL,
            week_key      VARCHAR(10)     NOT NULL DEFAULT '',
            plain_text    LONGTEXT        NOT NULL,
            html_content  LONGTEXT        NOT NULL,
            confluence_url VARCHAR(1000)  NOT NULL DEFAULT '',
            parsed_data   JSON            NULL,
            diff_data     JSON            NULL,
            synced_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY confluence_id (confluence_id),
            KEY author     (author),
            KEY week_key   (week_key),
            KEY report_date (report_date)
        ) $charset;";

        // 팀 전체 주간 요약
        $sql2 = "CREATE TABLE IF NOT EXISTS {$wpdb->prefix}wrd_team_summary (
            id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            week_key     VARCHAR(10)     NOT NULL,
            summary_data JSON            NOT NULL,
            created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY week_key (week_key)
        ) $charset;";

        // 동기화 로그
        $sql3 = "CREATE TABLE IF NOT EXISTS {$wpdb->prefix}wrd_sync_log (
            id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            status     VARCHAR(20)     NOT NULL DEFAULT 'success',
            message    TEXT            NULL,
            synced_cnt INT             NOT NULL DEFAULT 0,
            created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY status (status)
        ) $charset;";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql1);
        dbDelta($sql2);
        dbDelta($sql3);

        update_option('wrd_db_version', WRD_DB_VERSION);
    }

    /** 보고 저장 또는 갱신 */
    public static function upsert_report(array $data): int|false {
        global $wpdb;
        $table = $wpdb->prefix . 'wrd_reports';

        $existing = $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM $table WHERE confluence_id = %s",
            $data['confluence_id']
        ));

        $row = [
            'confluence_id'  => $data['confluence_id'],
            'author'         => $data['author']         ?? '',
            'title'          => $data['title']          ?? '',
            'report_date'    => $data['report_date']    ?? null,
            'week_key'       => $data['week_key']       ?? '',
            'plain_text'     => $data['plain_text']     ?? '',
            'html_content'   => $data['html_content']   ?? '',
            'confluence_url' => $data['confluence_url'] ?? '',
            'parsed_data'    => isset($data['parsed_data']) ? wp_json_encode($data['parsed_data'], JSON_UNESCAPED_UNICODE) : null,
            'diff_data'      => isset($data['diff_data'])   ? wp_json_encode($data['diff_data'],   JSON_UNESCAPED_UNICODE) : null,
            'synced_at'      => current_time('mysql'),
        ];

        if ($existing) {
            $wpdb->update($table, $row, ['id' => $existing]);
            return (int) $existing;
        }

        $wpdb->insert($table, $row);
        return $wpdb->insert_id ?: false;
    }

    /** 팀 요약 저장 */
    public static function upsert_team_summary(string $week_key, array $summary): void {
        global $wpdb;
        $table = $wpdb->prefix . 'wrd_team_summary';

        $wpdb->replace($table, [
            'week_key'     => $week_key,
            'summary_data' => wp_json_encode($summary, JSON_UNESCAPED_UNICODE),
            'created_at'   => current_time('mysql'),
        ]);
    }

    /** 이번 주 팀원 보고 전체 조회 */
    public static function get_current_week_reports(): array {
        global $wpdb;
        $week_key = self::current_week_key();
        $table    = $wpdb->prefix . 'wrd_reports';

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM $table WHERE week_key = %s ORDER BY author ASC",
            $week_key
        ), ARRAY_A);

        return array_map(function ($row) {
            $row['parsed_data'] = $row['parsed_data'] ? json_decode($row['parsed_data'], true) : null;
            $row['diff_data']   = $row['diff_data']   ? json_decode($row['diff_data'],   true) : null;
            return $row;
        }, $rows ?: []);
    }

    /** 특정 주 팀원 보고 조회 */
    public static function get_reports_by_week(string $week_key): array {
        global $wpdb;
        $table = $wpdb->prefix . 'wrd_reports';

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM $table WHERE week_key = %s ORDER BY author ASC",
            $week_key
        ), ARRAY_A);

        return array_map(function ($row) {
            $row['parsed_data'] = $row['parsed_data'] ? json_decode($row['parsed_data'], true) : null;
            $row['diff_data']   = $row['diff_data']   ? json_decode($row['diff_data'],   true) : null;
            return $row;
        }, $rows ?: []);
    }

    /** 팀 요약 조회 */
    public static function get_team_summary(?string $week_key = null): ?array {
        global $wpdb;
        $week_key = $week_key ?? self::current_week_key();
        $table    = $wpdb->prefix . 'wrd_team_summary';

        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM $table WHERE week_key = %s",
            $week_key
        ), ARRAY_A);

        if (!$row) return null;
        $row['summary_data'] = json_decode($row['summary_data'], true);
        return $row;
    }

    /** 사용 가능한 주 목록 (최근 12주) */
    public static function get_available_weeks(): array {
        global $wpdb;
        $table = $wpdb->prefix . 'wrd_reports';
        return $wpdb->get_col(
            "SELECT DISTINCT week_key FROM $table ORDER BY week_key DESC LIMIT 12"
        ) ?: [];
    }

    /** 동기화 로그 기록 */
    public static function log_sync(string $status, string $message = '', int $count = 0): void {
        global $wpdb;
        $wpdb->insert($wpdb->prefix . 'wrd_sync_log', [
            'status'     => $status,
            'message'    => $message,
            'synced_cnt' => $count,
            'created_at' => current_time('mysql'),
        ]);
    }

    /** 현재 주 키 (예: 2025-W03) */
    public static function current_week_key(): string {
        return date('Y-\WW');
    }

    /** 날짜로 주 키 계산 */
    public static function date_to_week_key(string $date): string {
        return date('Y-\WW', strtotime($date));
    }
}
