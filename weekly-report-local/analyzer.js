/**
 * Claude AI 없이 텍스트 파싱으로 주간보고 분석
 * 한국어 키워드 기반 규칙 파싱
 */

const COMPLETED_KEYWORDS = ['완료', '✅', '마무리', '배포', '릴리즈', '종료', '끝남', '확정'];
const INPROGRESS_KEYWORDS = ['진행', '중', '작업중', '개발중', '검토중', '진행중', '분석중'];
const BLOCKED_KEYWORDS = ['지연', '블로킹', '이슈', '문제', '실패', '오류', '차단'];
const PLANNED_KEYWORDS = ['예정', '계획', '준비', '검토 예정', '다음주'];

function detectStatus(text) {
  if (COMPLETED_KEYWORDS.some(k => text.includes(k))) return 'completed';
  if (BLOCKED_KEYWORDS.some(k => text.includes(k))) return 'blocked';
  if (INPROGRESS_KEYWORDS.some(k => text.includes(k))) return 'in_progress';
  if (PLANNED_KEYWORDS.some(k => text.includes(k))) return 'planned';
  return 'in_progress';
}

function detectProgress(text, status) {
  const percentMatch = text.match(/(\d{1,3})\s*%/);
  if (percentMatch) return Math.min(100, parseInt(percentMatch[1]));
  if (status === 'completed') return 100;
  if (status === 'planned') return 0;
  if (status === 'blocked') return 30;
  return 50;
}

function extractPeriod(title) {
  const match = title.match(/(\d{2}\/\d{1,2}\/\d{1,2})/);
  return match ? match[1] : title;
}

function parseLines(text) {
  return text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
}

function extractCategories(text) {
  const lines = parseLines(text);
  const categories = [];
  let currentCat = null;

  for (const line of lines) {
    // 카테고리 헤더: 줄 앞에 ##, **, 또는 공백 없이 시작하는 짧은 텍스트
    const isHeader = /^(#{1,3}|▶|■|●|\*{1,2})\s*.+/.test(line) ||
                     (line.length < 40 && !line.startsWith('-') && !line.startsWith('•') && /[가-힣A-Z]/.test(line[0]));

    if (isHeader) {
      const name = line.replace(/^(#{1,3}|▶|■|●|\*{1,2})\s*/, '').replace(/\*+/g, '').trim();
      if (name.length > 0 && name.length < 50) {
        currentCat = { name, tasks: [], rawLines: [] };
        categories.push(currentCat);
        continue;
      }
    }

    if (currentCat && (line.startsWith('-') || line.startsWith('•') || line.startsWith('*'))) {
      const taskText = line.replace(/^[-•*]\s*/, '').trim();
      if (taskText.length > 0) {
        currentCat.rawLines.push(taskText);
      }
    }
  }

  // 카테고리가 없으면 전체를 하나로
  if (categories.length === 0) {
    categories.push({ name: '업무', rawLines: lines.filter(l => l.startsWith('-') || l.startsWith('•')).map(l => l.replace(/^[-•]\s*/, '')), tasks: [] });
  }

  // 각 카테고리 tasks 구성
  return categories.map(cat => {
    const tasks = cat.rawLines.map(line => {
      const status = detectStatus(line);
      return {
        title: line.substring(0, 80),
        status,
        progress: detectProgress(line, status),
        detail: line,
      };
    });

    const progress = tasks.length > 0
      ? Math.round(tasks.reduce((sum, t) => sum + t.progress, 0) / tasks.length)
      : 50;

    return { name: cat.name, tasks, progress };
  }).filter(cat => cat.tasks.length > 0 || categories.length === 1);
}

function extractHighlights(text) {
  const lines = parseLines(text);
  return lines
    .filter(l => COMPLETED_KEYWORDS.some(k => l.includes(k)) && l.length < 100)
    .slice(0, 5)
    .map(l => l.replace(/^[-•*]\s*/, ''));
}

function extractIssues(text) {
  const lines = parseLines(text);
  return lines
    .filter(l => BLOCKED_KEYWORDS.some(k => l.includes(k)) && l.length < 100)
    .slice(0, 5)
    .map(l => l.replace(/^[-•*]\s*/, ''));
}

function extractNextPlans(text) {
  const lines = parseLines(text);
  return lines
    .filter(l => PLANNED_KEYWORDS.some(k => l.includes(k)) && l.length < 100)
    .slice(0, 5)
    .map(l => l.replace(/^[-•*]\s*/, ''));
}

/**
 * 주간보고 텍스트 → 구조화 데이터 파싱 (AI 없이)
 */
export async function parseReport(text, title) {
  const categories = extractCategories(text);
  const allTasks = categories.flatMap(c => c.tasks);
  const overall_progress = allTasks.length > 0
    ? Math.round(allTasks.reduce((sum, t) => sum + t.progress, 0) / allTasks.length)
    : 50;

  return {
    title,
    period: extractPeriod(title),
    categories,
    overall_progress,
    highlights: extractHighlights(text),
    issues: extractIssues(text),
    next_plans: extractNextPlans(text),
    summary: `총 ${allTasks.length}개 작업 중 ${allTasks.filter(t => t.status === 'completed').length}개 완료, 진척도 ${overall_progress}%`,
  };
}

/**
 * 이번주 vs 지난주 비교 (AI 없이)
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
  const summary = `지난주 대비 진척도 ${deltaText}. 완료 ${completed_items.length}건, 신규 ${new_items.length}건, 이슈 ${new_issues.length}건.`;
  const manager_comment = `전체 진척도 ${current.overall_progress}% (${deltaText}). ${risk === 'high' ? '이슈가 많아 점검이 필요합니다.' : risk === 'medium' ? '일부 항목 모니터링을 권장합니다.' : '전반적으로 안정적입니다.'}`;

  return {
    progress_delta: delta,
    new_items,
    completed_items,
    ongoing_items,
    new_issues,
    resolved_issues,
    summary,
    manager_comment,
    risk,
  };
}
