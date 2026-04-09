<?php
/**
 * Plugin Name: Weekly Report Dashboard
 * Plugin URI:  https://github.com/your-team/weekly-report-dashboard
 * Description: Confluence 주간보고를 실시간으로 동기화하여 진척도 대시보드를 표시합니다.
 * Version:     1.0.0
 * Author:      Your Team
 * Text Domain: wrd
 * Requires PHP: 8.0
 * Requires at least: 6.0
 */

defined('ABSPATH') || exit;

define('WRD_VERSION',    '1.0.0');
define('WRD_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('WRD_PLUGIN_URL', plugin_dir_url(__FILE__));
define('WRD_DB_VERSION', '1');

// ── 자동 로드 ─────────────────────────────────────────────────────────────
require_once WRD_PLUGIN_DIR . 'includes/class-db.php';
require_once WRD_PLUGIN_DIR . 'includes/class-confluence-sync.php';
require_once WRD_PLUGIN_DIR . 'includes/class-api.php';
require_once WRD_PLUGIN_DIR . 'includes/class-admin.php';
require_once WRD_PLUGIN_DIR . 'includes/class-shortcode.php';

// ── 활성화 / 비활성화 훅 ─────────────────────────────────────────────────
register_activation_hook(__FILE__, ['WRD_DB', 'install']);
register_deactivation_hook(__FILE__, ['WRD_Admin', 'deactivate']);

// ── 초기화 ────────────────────────────────────────────────────────────────
add_action('plugins_loaded', function () {
    WRD_API::init();
    WRD_Admin::init();
    WRD_Shortcode::init();
});

// ── WP Cron 스케줄 등록 ───────────────────────────────────────────────────
add_filter('cron_schedules', function ($schedules) {
    $schedules['wrd_every_30min'] = [
        'interval' => 1800,
        'display'  => '30분마다',
    ];
    $schedules['wrd_every_hour'] = [
        'interval' => 3600,
        'display'  => '매 시간',
    ];
    return $schedules;
});

add_action('wrd_auto_sync', function () {
    $sync = new WRD_Confluence_Sync();
    $sync->run();
});

// 플러그인 활성화 시 cron 등록
if (!wp_next_scheduled('wrd_auto_sync')) {
    $interval = get_option('wrd_sync_interval', 'wrd_every_hour');
    wp_schedule_event(time(), $interval, 'wrd_auto_sync');
}
