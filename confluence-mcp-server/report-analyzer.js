import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Claude를 이용해 주간보고 텍스트를 구조화된 데이터로 파싱하고 분석
 */
export class ReportAnalyzer {

  /**
   * 주간보고 텍스트에서 진척도 정보 추출
   * @param {string} reportText - 주간보고 원문 텍스트
   * @param {string} authorName - 작성자 이름
   * @returns {Object} 구조화된 보고 데이터
   */
  async parseReport(reportText, authorName = '미상') {
    const prompt = `다음은 팀원의 주간보고 텍스트입니다. 이 텍스트를 분석하여 JSON 형식으로 구조화해주세요.

작성자: ${authorName}

--- 주간보고 원문 ---
${reportText}
--- 끝 ---

다음 JSON 구조로 응답해주세요 (다른 텍스트 없이 JSON만):
{
  "author": "작성자명",
  "summary": "이번 주 전체 요약 (2-3문장)",
  "tasks": [
    {
      "title": "작업명",
      "status": "completed|in_progress|blocked|planned",
      "progress": 0~100 (숫자),
      "detail": "세부 내용"
    }
  ],
  "overall_progress": 0~100 (전체 진척도 평균, 숫자),
  "highlights": ["주요 성과1", "주요 성과2"],
  "issues": ["이슈/블로커1", "이슈/블로커2"],
  "next_week_plan": ["다음주 계획1", "다음주 계획2"],
  "sentiment": "positive|neutral|negative",
  "keywords": ["핵심키워드1", "핵심키워드2", "핵심키워드3"]
}

상태 판단 기준:
- completed: 완료, 완성, 마침, done, 100%
- in_progress: 진행중, 진행 중, 작업중, ~% 완료
- blocked: 블로킹, 막힘, 대기중, 이슈로 인해 지연
- planned: 예정, 계획, 다음주`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text.trim();
    try {
      // JSON 코드블록 제거 후 파싱
      const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(jsonStr);
    } catch {
      // 파싱 실패 시 기본 구조 반환
      return {
        author: authorName,
        summary: reportText.substring(0, 200),
        tasks: [],
        overall_progress: 50,
        highlights: [],
        issues: [],
        next_week_plan: [],
        sentiment: 'neutral',
        keywords: [],
      };
    }
  }

  /**
   * 이번주 보고와 지난주 보고를 비교 분석
   * @param {Object} currentReport - 이번주 파싱된 보고
   * @param {Object} previousReport - 지난주 파싱된 보고 (없으면 null)
   * @returns {Object} 변화 분석 결과
   */
  async analyzeDiff(currentReport, previousReport) {
    if (!previousReport) {
      return {
        progress_change: 0,
        new_tasks: currentReport.tasks || [],
        completed_tasks: [],
        still_in_progress: [],
        new_issues: currentReport.issues || [],
        resolved_issues: [],
        manager_comment: '이번 주 첫 보고입니다.',
        change_summary: '첫 번째 주간보고로 비교 데이터가 없습니다.',
      };
    }

    const prompt = `이번주와 지난주 주간보고 데이터를 비교하여 변화를 분석해주세요.

--- 지난주 보고 ---
${JSON.stringify(previousReport, null, 2)}

--- 이번주 보고 ---
${JSON.stringify(currentReport, null, 2)}

다음 JSON 구조로 응답해주세요 (다른 텍스트 없이 JSON만):
{
  "progress_change": 진척도 변화값 (이번주 - 지난주, 정수),
  "new_tasks": ["새로 시작한 작업들"],
  "completed_tasks": ["지난주 대비 완료된 작업들"],
  "still_in_progress": ["계속 진행 중인 작업들"],
  "new_issues": ["새로 발생한 이슈"],
  "resolved_issues": ["해결된 이슈"],
  "manager_comment": "매니저를 위한 핵심 코멘트 (2-3문장, 칭찬/우려사항 포함)",
  "change_summary": "변화 요약 (1-2문장, 한국어)",
  "risk_level": "low|medium|high",
  "recommendation": "추천 액션 아이템"
}`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text.trim();
    try {
      const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(jsonStr);
    } catch {
      return {
        progress_change: (currentReport.overall_progress || 0) - (previousReport.overall_progress || 0),
        new_tasks: [],
        completed_tasks: [],
        still_in_progress: [],
        new_issues: [],
        resolved_issues: [],
        manager_comment: '분석 중 오류가 발생했습니다.',
        change_summary: '자동 분석 불가',
        risk_level: 'medium',
        recommendation: '수동 검토 필요',
      };
    }
  }

  /**
   * 팀 전체 주간보고 종합 분석
   * @param {Array} teamReports - 팀원별 현재 보고 배열
   * @param {Array} prevTeamReports - 팀원별 이전 보고 배열
   */
  async analyzeTeamSummary(teamReports, prevTeamReports = []) {
    const avgProgress = teamReports.reduce((s, r) => s + (r.parsed?.overall_progress || 0), 0) / (teamReports.length || 1);
    const prevAvgProgress = prevTeamReports.reduce((s, r) => s + (r.parsed?.overall_progress || 0), 0) / (prevTeamReports.length || 1);

    const allIssues = teamReports.flatMap(r => r.parsed?.issues || []);
    const allHighlights = teamReports.flatMap(r => r.parsed?.highlights || []);

    const prompt = `팀 전체 주간보고를 종합 분석해주세요.

팀 현황:
- 팀원 수: ${teamReports.length}명
- 이번주 평균 진척도: ${avgProgress.toFixed(1)}%
- 지난주 평균 진척도: ${prevAvgProgress.toFixed(1)}%
- 전체 이슈: ${allIssues.join(', ') || '없음'}
- 주요 성과: ${allHighlights.slice(0, 5).join(', ') || '없음'}

팀원별 요약:
${teamReports.map(r => `• ${r.author}: ${r.parsed?.overall_progress || 0}% (${r.parsed?.sentiment || 'neutral'})`).join('\n')}

다음 JSON 구조로만 응답해주세요:
{
  "team_health": "excellent|good|fair|poor",
  "avg_progress": ${avgProgress.toFixed(1)},
  "progress_trend": "improving|stable|declining",
  "top_risks": ["리스크1", "리스크2"],
  "team_highlights": ["팀 성과1", "팀 성과2"],
  "action_items": ["액션아이템1", "액션아이템2"],
  "executive_summary": "경영진/팀장을 위한 3-4문장 요약"
}`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text.trim();
    try {
      const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(jsonStr);
    } catch {
      return {
        team_health: 'fair',
        avg_progress: avgProgress,
        progress_trend: 'stable',
        top_risks: allIssues.slice(0, 2),
        team_highlights: allHighlights.slice(0, 2),
        action_items: [],
        executive_summary: '팀 보고 분석을 완료했습니다.',
      };
    }
  }
}
