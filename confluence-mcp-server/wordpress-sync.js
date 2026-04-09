import axios from 'axios';

/**
 * WordPress REST API를 통해 분석 결과를 WordPress에 동기화
 * WordPress에서 Application Password를 생성하여 인증
 */
export class WordPressSync {
  constructor(config) {
    this.baseUrl = config.url.replace(/\/$/, '');
    const auth = Buffer.from(`${config.user}:${config.password}`).toString('base64');

    this.http = axios.create({
      baseURL: `${this.baseUrl}/wp-json`,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /** 플러그인의 커스텀 REST 엔드포인트로 보고 데이터 업로드 */
  async syncReportData(data) {
    try {
      const response = await this.http.post('/weekly-report/v1/sync', data);
      return { success: true, data: response.data };
    } catch (error) {
      const msg = error.response?.data?.message || error.message;
      throw new Error(`WordPress 동기화 실패: ${msg}`);
    }
  }

  /** WordPress 옵션에 팀 요약 저장 */
  async saveSummary(summary) {
    return this.syncReportData({ type: 'team_summary', payload: summary });
  }

  /** 팀원 개별 보고 저장 */
  async saveMemberReport(memberData) {
    return this.syncReportData({ type: 'member_report', payload: memberData });
  }

  /** 마지막 동기화 시각 업데이트 */
  async updateSyncTime() {
    return this.syncReportData({
      type: 'sync_time',
      payload: { synced_at: new Date().toISOString() },
    });
  }
}
