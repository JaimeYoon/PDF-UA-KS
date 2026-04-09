<?php
defined('ABSPATH') || exit;

class WRD_Shortcode {

    public static function init(): void {
        add_shortcode('weekly_report_dashboard', [self::class, 'render']);
        add_action('wp_enqueue_scripts', [self::class, 'enqueue_assets']);
    }

    public static function enqueue_assets(): void {
        if (!is_singular()) return;
        global $post;
        if (!$post || !has_shortcode($post->post_content, 'weekly_report_dashboard')) return;

        wp_enqueue_style(
            'wrd-dashboard',
            WRD_PLUGIN_URL . 'assets/dashboard.css',
            [],
            WRD_VERSION
        );
        wp_enqueue_script(
            'chart-js',
            'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
            [],
            '4.4.0',
            true
        );
        wp_enqueue_script(
            'wrd-dashboard',
            WRD_PLUGIN_URL . 'assets/dashboard.js',
            ['chart-js'],
            WRD_VERSION,
            true
        );
        wp_localize_script('wrd-dashboard', 'WRD_Config', [
            'apiBase'   => rest_url('weekly-report/v1'),
            'nonce'     => wp_create_nonce('wp_rest'),
            'isAdmin'   => current_user_can('manage_options') ? '1' : '0',
        ]);
    }

    public static function render(array $atts): string {
        ob_start();
        include WRD_PLUGIN_DIR . 'templates/dashboard.php';
        return ob_get_clean();
    }
}
