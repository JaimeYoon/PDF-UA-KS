/**
 * AX플랫폼전략팀 주간보고 형식 파서
 * 형식: ## [날짜] 이름 주간 업무 보고 + Phase N 진행율 : X% + [진행]/[완료] 태그
 */

function extractPeriod(title) {
  const match = title.match(/\[(\d+\/\d+)\]/) || title.match(/(\d{2}\/\d{1,2}\/\d{1,2})/);
  return match ? match[1] : title;
}

function detectStatus(text) {
  if (/\[완료\]|완료\)|완료,/.test(text)) return 'completed';
  if (/\[진행\]|진행\)|~\d/.test(text)) return 'in_progress';
  if (/\[예정\]|예정\)|예정,/.test(text)) return 'planned';
  if (/지연|블로킹|이슈|문제/.test(text)) return 'blocked';
  return 'in_progress';
}

function extractPhaseProgress(text) {
  const match = text.match(/Phase\s*\d+\s*진행율?\s*:\s*(\d{1,3})%/i)
    || text.match(/진행율?\s*:\s*(\d{1,3})%/i);
  return match ? parseInt(match[1]) : null;
}

function extractInlineProgress(text) {
  const match = text.match(/(\d{1,3})\s*%/);
  return match ? Math.min(100, parseInt(match[1])) : null;
}

function removeSection(text, heading) {
  // 작성예시 등 불필요 섹션 제거
  const idx = text.indexOf(heading);
  if (idx === -1) return text;
  const nextHeading = text.indexOf('\n## ', idx + heading.length);
  return nextHeading === -1 ? text.substring(0, idx) : text.substring(0, idx) + text.substring(nextHeading);
}

function parseMemberSection(name, body) {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  const tasks = [];
  let currentArea = null;
  let areaProgress = null;

  for (const line of lines) {
    // 업무 영역 헤더 (진행율 포함)
    const phaseProgress = extractPhaseProgress(line);
    if (phaseProgress !== null && line.includes('Phase')) {
      currentArea = line.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').trim().substring(0, 60);
      areaProgress = phaseProgress;
      continue;
    }

    // 세부 작업 항목
    if (line.startsWith('*') || line.startsWith('-') || line.startsWith('•')) {
      const taskText = line.replace(/^[*\-•]+\s*/, '').trim();
      if (taskText.length < 5) continue;
      const status = detectStatus(taskText);
      const progress = status === 'completed' ? 100
        : status === 'planned' ? 0
        : extractInlineProgress(taskText) || (areaProgress !== null ? areaProgress : 50);
      tasks.push({
        title: taskText.substring(0, 80).replace(/\(.*?\)$/, '').trim(),
        status,
        progress,
        detail: taskText,
      });
    }
  }

  const progress = tasks.length > 0
    ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length)
    : areaProgress || 50;

  return { name, tasks, progress };
}

function parseAXFormat(text, title) {
  // 작성예시 섹션 제거
  let cleaned = removeSection(text, '작성예시');
  cleaned = removeSection(cleaned, '**작성예시**');

  // 팀원별 섹션 분리: ## [날짜] 이름 주간 업무 보고
  const memberPattern = /##\s*\[.*?\]\s+(.+?)\s+주간\s+업무\s+보고/g;
  const sections = [];
  let match;
  const positions = [];

  while ((match = memberPattern.exec(cleaned)) !== null) {
    positions.push({ name: match[1].trim(), start: match.index, end: match.index + match[0].length });
  }

  for (let i = 0; i < positions.length; i++) {
    const { name, end } = positions[i];
    const nextStart = positions[i + 1]?.start ?? cleaned.length;
    const body = cleaned.substring(end, nextStart);
    sections.push(parseMemberSection(name, body));
  }

  return sections.filter(s => s.tasks.length > 0);
}

function extractHighlights(text) {
  return text.split('\n')
    .filter(l => /완료\)|완료,|\[완료\]/.test(l) && l.length < 120)
    .slice(0, 6)
    .map(l => l.replace(/^[*\-•]+\s*/, '').replace(/\(.*?\)$/, '').trim());
}

function extractIssues(text) {
  return text.split('\n')
    .filter(l => /지연|이슈|문제|딜레이|블로킹/.test(l) && l.length < 120)
    .slice(0, 5)
    .map(l => l.replace(/^[*\-•]+\s*/, '').trim());
}

function extractNextPlans(text) {
  return text.split('\n')
    .filter(l => /예정\)|예정,|\[예정\]|예정$/.test(l) && l.length < 120)
    .slice(0, 5)
    .map(l => l.replace(/^[*\-•]+\s*/, '').trim());
}

/**
 * 주간보고 텍스트 → 구조화 데이터 파싱
 */
export async function parseReport(text, title) {
  // AX플랫폼전략팀 형식 우선 시도
  const categories = parseAXFormat(text, title);

  // 파싱 실패 시 폴백: 전체 텍스트를 단일 카테고리로
  if (categories.length === 0) {
    const lines = text.split('\n').filter(l => l.trim());
    const tasks = lines
      .filter(l => /^[*\-•]/.test(l.trim()))
      .slice(0, 20)
      .map(l => {
        const t = l.replace(/^[*\-•]+\s*/, '').trim();
        const status = detectStatus(t);
        return { title: t.substring(0, 80), status, progress: status === 'completed' ? 100 : 50, detail: t };
      });
    categories.push({ name: '업무', tasks, progress: 50 });
  }

  const allTasks = categories.flatMap(c => c.tasks);
  const overall_progress = allTasks.length > 0
    ? Math.round(allTasks.reduce((s, t) => s + t.progress, 0) / allTasks.length)
    : 50;

  const completedCount = allTasks.filter(t => t.status === 'completed').length;

  return {
    title,
    period: extractPeriod(title),
    categories,
    overall_progress,
    highlights: extractHighlights(text),
    issues: extractIssues(text),
    next_plans: extractNextPlans(text),
    summary: `총 ${allTasks.length}개 작업 중 ${completedCount}개 완료 (${overall_progress}%)`,
  };
}

/**
 * 이번주 vs 지난주 비교
 */
export async function analyzeDiff(current, previous) {
  if (!previous) {
    return {
      progress_delta: 0,
      new_items: [],
      completed_items: current.highlights || [],
      ongoing_items: [],
      new_issues: current.issues || [],
      resolved_issues: [],
      summary: '이전 주 데이터가 없어 비교할 수 없습니다.',
      manager_comment: '첫 번째 분석입니다. 다음 주부터 변화를 추적합니다.',
      risk: 'low',
    };
  }

  const delta = (current.overall_progress || 0) - (previous.overall_progress || 0);
  const prevTitles = new Set((previous.categories || []).flatMap(c => c.tasks.map(t => t.title)));
  const currTasks = (current.categories || []).flatMap(c => c.tasks);

  const completed_items = currTasks.filter(t => t.status === 'completed').map(t => t.title).slice(0, 5);
  const new_items = currTasks.filter(t => !prevTitles.has(t.title)).map(t => t.title).slice(0, 5);
  const ongoing_items = currTasks.filter(t => t.status === 'in_progress').map(t => t.title).slice(0, 5);

  const prevIssues = new Set(previous.issues || []);
  const new_issues = (current.issues || []).filter(i => !prevIssues.has(i));
  const resolved_issues = (previous.issues || []).filter(i => !(current.issues || []).includes(i));

  const risk = new_issues.length > 2 ? 'high' : delta < -10 ? 'medium' : 'low';
  const deltaText = delta > 0 ? `${delta}% 향상` : delta < 0 ? `${Math.abs(delta)}% 하락` : '변화 없음';

  return {
    progress_delta: delta,
    new_items,
    completed_items,
    ongoing_items,
    new_issues,
    resolved_issues,
    summary: `지난주 대비 진척도 ${deltaText}. 완료 ${completed_items.length}건, 신규 ${new_items.length}건, 이슈 ${new_issues.length}건.`,
    manager_comment: `전체 진척도 ${current.overall_progress}% (${deltaText}). ${risk === 'high' ? '이슈가 많아 점검이 필요합니다.' : risk === 'medium' ? '일부 항목 모니터링을 권장합니다.' : '전반적으로 안정적입니다.'}`,
    risk,
  };
}
