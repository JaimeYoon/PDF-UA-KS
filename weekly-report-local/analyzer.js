import Anthropic from '@anthropic-ai/sdk';

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * 주간보고 텍스트 → 구조화 데이터 파싱
 * 실제 보고서 형식: 카테고리별(SDK, FOXIT 등) 작업 목록
 */
export async function parseReport(text, title) {
  const msg = await ai.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `다음은 팀의 주간 업무 보고입니다. 분석하여 JSON으로만 응답해주세요.

제목: ${title}
---
${text.substring(0, 6000)}
---

JSON 형식:
{
  "title": "보고서 제목",
  "period": "보고 기간 (제목에서 추출, 예: 26/5/13)",
  "categories": [
    {
      "name": "카테고리명 (예: SDK, FOXIT OFFICE SDK, 기타)",
      "tasks": [
        {
          "title": "작업명",
          "status": "completed|in_progress|planned|blocked",
          "progress": 0~100,
          "detail": "세부 내용 요약"
        }
      ],
      "progress": 0~100
    }
  ],
  "overall_progress": 0~100,
  "highlights": ["주요 성과1", "주요 성과2"],
  "issues": ["이슈1"],
  "next_plans": ["다음 계획1"],
  "summary": "전체 요약 2-3문장"
}

status 판단: completed(완료/✅), in_progress(진행중/~중), planned(예정), blocked(지연/이슈)`
    }],
  });

  const raw = msg.content[0].text.replace(/```json\n?|```\n?/g, '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    return { title, summary: text.substring(0, 300), categories: [], overall_progress: 50, highlights: [], issues: [], next_plans: [] };
  }
}

/**
 * 이번주 vs 지난주 비교 분석
 */
export async function analyzeDiff(current, previous) {
  if (!previous) {
    return {
      progress_delta: 0,
      new_items: [],
      completed_items: [],
      ongoing_items: [],
      new_issues: current.issues || [],
      summary: '이전 주 데이터가 없어 비교할 수 없습니다.',
      manager_comment: '첫 번째 분석입니다.',
      risk: 'low',
    };
  }

  const msg = await ai.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: `이번주와 지난주 주간보고를 비교하여 JSON으로만 응답하세요.

지난주(${previous.title}):
진척도: ${previous.overall_progress}%
성과: ${(previous.highlights||[]).join(', ')}
이슈: ${(previous.issues||[]).join(', ')}
카테고리: ${(previous.categories||[]).map(c=>`${c.name}(${c.progress}%)`).join(', ')}

이번주(${current.title}):
진척도: ${current.overall_progress}%
성과: ${(current.highlights||[]).join(', ')}
이슈: ${(current.issues||[]).join(', ')}
카테고리: ${(current.categories||[]).map(c=>`${c.name}(${c.progress}%)`).join(', ')}

JSON 형식:
{
  "progress_delta": 이번주-지난주 진척도 차이(정수),
  "new_items": ["새로 시작된 작업들"],
  "completed_items": ["완료된 작업들"],
  "ongoing_items": ["계속 진행중인 주요 작업들"],
  "new_issues": ["새로 생긴 이슈들"],
  "resolved_issues": ["해결된 이슈들"],
  "summary": "변화 요약 1-2문장 (한국어)",
  "manager_comment": "팀장을 위한 핵심 코멘트 2-3문장",
  "risk": "low|medium|high"
}`
    }],
  });

  const raw = msg.content[0].text.replace(/```json\n?|```\n?/g, '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    return {
      progress_delta: (current.overall_progress || 0) - (previous.overall_progress || 0),
      summary: '비교 분석 중 오류가 발생했습니다.',
      manager_comment: '수동 검토가 필요합니다.',
      risk: 'medium',
    };
  }
}
