<?php
defined('ABSPATH') || exit;

/**
 * MCP HTTP 서버를 통해 Confluence 데이터를 WordPress DB로 동기화
 */
class WRD_Confluence_Sync {

    private string $mcp_url;
    private string $api_key;
    private int    $timeout = 120;

    public function __construct() {
        $this->mcp_url = rtrim(get_option('wrd_mcp_url', 'http://localhost:3456'), '/');
        $this->api_key = get_option('wrd_mcp_api_key', '');
    }

    /** 전체 동기화 실행 */
    public function run(): array {
        $space_key     = get_option('wrd_confluence_space', '');
        $title_pattern = get_option('wrd_title_pattern', '주간보고');

        if (empty($space_key)) {
            WRD_DB::log_sync('error', 'Confluence Space Key가 설정되지 않았습니다.');
            return ['success' => false, 'message' => 'Space Key 미설정'];
        }

        // 1) 보고 페이지 목록 조회
        $pages = $this->call_mcp('GET', '/reports', [
            'spaceKey'     => $space_key,
            'titlePattern' => $title_pattern,
            'limit'        => '30',
        ]);

        if (!$pages || !isset($pages['pages'])) {
            WRD_DB::log_sync('error', 'MCP 서버에서 페이지 목록을 가져오지 못했습니다.');
            return ['success' => false, 'message' => 'MCP 응답 오류'];
        }

        $all_pages = $pages['pages'];
        if (empty($all_pages)) {
            WRD_DB::log_sync('success', '동기화할 페이지가 없습니다.', 0);
            return ['success' => true, 'synced' => 0];
        }

        // 2) 이번주 / 지난주 분리
        $week_key      = WRD_DB::current_week_key();
        $prev_week_key = $this->prev_week_key();
        $synced        = 0;

        // 3) 각 페이지 분석 및 저장
        $current_week_page_ids  = [];
        $previous_week_page_ids = [];

        foreach ($all_pages as $page) {
            $page_date  = $this->extract_date_from_title($page['title'] ?? '');
            $page_week  = $page_date ? WRD_DB::date_to_week_key($page_date) : $week_key;

            if ($page_week === $week_key) {
                $current_week_page_ids[] = $page['id'];
            } elseif ($page_week === $prev_week_key) {
                $previous_week_page_ids[] = $page['id'];
            }
        }

        // 4) 이번주 페이지 분석
        $current_reports  = [];
        $previous_reports = [];

        foreach ($current_week_page_ids as $page_id) {
            $result = $this->call_mcp('POST', '/analyze', ['pageId' => $page_id]);
            if ($result && $result['success']) {
                $report_data = $this->build_report_row($result, $week_key);
                WRD_DB::upsert_report($report_data);
                $current_reports[] = $result;
                $synced++;
            }
        }

        // 5) 지난주 페이지 분석 (비교용)
        foreach ($previous_week_page_ids as $page_id) {
            $result = $this->call_mcp('POST', '/analyze', ['pageId' => $page_id]);
            if ($result && $result['success']) {
                $previous_reports[] = $result;
                // 지난주 데이터도 DB에 저장
                $report_data = $this->build_report_row($result, $prev_week_key);
                WRD_DB::upsert_report($report_data);
            }
        }

        // 6) 이번주 vs 지난주 diff 계산 후 DB 업데이트
        if (!empty($current_reports) && !empty($previous_reports)) {
            foreach ($current_reports as $curr) {
                $curr_author = $curr['parsed']['author'] ?? '';
                // 같은 작성자의 지난주 보고 찾기
                $prev = array_filter($previous_reports, fn($p) =>
                    ($p['parsed']['author'] ?? '') === $curr_author
                );
                $prev = array_values($prev);

                if (!empty($prev)) {
                    $diff_result = $this->call_mcp('POST', '/compare', [
                        'currentPageId'  => $curr['content']['id'],
                        'previousPageId' => $prev[0]['content']['id'],
                    ]);
                    if ($diff_result && $diff_result['success']) {
                        global $wpdb;
                        $wpdb->update(
                            $wpdb->prefix . 'wrd_reports',
                            ['diff_data' => wp_json_encode($diff_result['diff'], JSON_UNESCAPED_UNICODE)],
                            ['confluence_id' => $curr['content']['id']]
                        );
                    }
                }
            }
        }

        // 7) 팀 요약 생성 요청
        $team_summary = $this->call_mcp('POST', '/sync', []);
        if ($team_summary && isset($team_summary['teamSummary'])) {
            WRD_DB::upsert_team_summary($week_key, $team_summary['teamSummary']);
        }

        // 8) 마지막 동기화 시각 업데이트
        update_option('wrd_last_sync', current_time('mysql'));

        WRD_DB::log_sync('success', "총 {$synced}건 동기화 완료", $synced);
        return ['success' => true, 'synced' => $synced];
    }

    /** MCP HTTP 서버 호출 */
    private function call_mcp(string $method, string $path, array $data = []): ?array {
        $url     = $this->mcp_url . $path;
        $headers = ['Content-Type' => 'application/json'];

        if (!empty($this->api_key)) {
            $headers['X-Api-Key'] = $this->api_key;
        }

        $args = [
            'method'  => $method,
            'headers' => $headers,
            'timeout' => $this->timeout,
        ];

        if ($method === 'GET' && !empty($data)) {
            $url = add_query_arg($data, $url);
        } elseif ($method === 'POST') {
            $args['body'] = wp_json_encode($data);
        }

        $response = wp_remote_request($url, $args);

        if (is_wp_error($response)) {
            error_log('[WRD] MCP 호출 오류: ' . $response->get_error_message());
            return null;
        }

        $body = wp_remote_retrieve_body($response);
        $code = wp_remote_retrieve_response_code($response);

        if ($code < 200 || $code >= 300) {
            error_log("[WRD] MCP HTTP {$code}: {$body}");
            return null;
        }

        return json_decode($body, true);
    }

    /** MCP 응답을 DB 저장 형태로 변환 */
    private function build_report_row(array $result, string $week_key): array {
        $content = $result['content'] ?? [];
        $parsed  = $result['parsed']  ?? [];

        return [
            'confluence_id'  => $content['id']           ?? '',
            'author'         => $content['author']        ?? ($parsed['author'] ?? ''),
            'title'          => $content['title']         ?? '',
            'report_date'    => $this->extract_date_from_title($content['title'] ?? '') ?? date('Y-m-d', strtotime($content['lastModified'] ?? 'now')),
            'week_key'       => $week_key,
            'plain_text'     => $content['plainText']     ?? '',
            'html_content'   => $content['html']          ?? '',
            'confluence_url' => $content['url']           ?? '',
            'parsed_data'    => $parsed,
        ];
    }

    /** 보고서 제목에서 날짜 추출 (예: "주간보고 2025-01-06" → "2025-01-06") */
    private function extract_date_from_title(string $title): ?string {
        // YYYY-MM-DD 형식
        if (preg_match('/(\d{4}-\d{2}-\d{2})/', $title, $m)) {
            return $m[1];
        }
        // YYYY년 W주차
        if (preg_match('/(\d{4})년?\s*(\d{1,2})주/', $title, $m)) {
            $dt = new DateTime();
            $dt->setISODate((int) $m[1], (int) $m[2]);
            return $dt->format('Y-m-d');
        }
        return null;
    }

    /** 지난주 키 */
    private function prev_week_key(): string {
        return date('Y-\WW', strtotime('-1 week'));
    }
}
