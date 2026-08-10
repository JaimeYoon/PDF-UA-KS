/**
 * AX사업기획실 주간업무 형식 파서 (AX1 스페이스, ancestor 2063040683)
 * 레이어별 파싱: Runtime & Agent Gateway, Agent Lifecycle, Security & Governance,
 *   Data & Integration, Document Solution Agent, User Layer + AX사업기획, AX기술 등
 */

const LAYER_PATTERNS = [
  { pattern: /Runtime\s*&\s*(?:Execution|Agent\s*Gateway|Execution\s*운영)/i, label: 'Runtime & Agent Gateway' },
  { pattern: /Agent\s*Lifecycle/i, label: 'Agent Lifecycle' },
  { pattern: /Security\s*&\s*Governance|Identity\s*&\s*Access/i, label: 'Security & Governance' },
  { pattern: /Instr?[au]?\s*&\s*Data|Data\s*&\s*Integration|Knowledge(?:\s*Hub)?/i, label: 'Data & Integration' },
  { pattern: /Document\s*Solution\s*Agent/i, label: 'Document Solution Agent' },
  { pattern: /User\s*Layer/i, label: 'User Layer' },
  { pattern: /Infrastructure/i, label: 'Infrastructure' },
];

// 레이어 이름을 본문 줄에서 찾아 label 반환
function detectLayer(line) {
  for (const { pattern, label } of LAYER_PATTERNS) {
    if (pattern.test(line)) return label;
  }
  return null;
}

// 최상위 섹션 헤더 감지 (AX플랫폼전략, AX사업기획, AX기술 등)
function detectTopSection(line) {
  const t = line.replace(/^[•*\-]+\s*/, '').replace(/\*+/g, '').trim();
  if (/^AX플랫폼전략/.test(t)) return 'AX플랫폼전략 (TFT 운영)';
  if (/^AX사업기획/.test(t)) return 'AX사업기획';
  if (/^AX기술/.test(t) || /^AX$/.test(t)) return 'AX기술';
  if (/^AgenticOS/.test(t)) return 'AgenticOS';
  if (/^리서치/.test(t)) return '리서치';
  if (/^사업$/.test(t)) return '사업';
  if (/^기타/.test(t)) return '기타';
  return null;
}

function detectStatus(text) {
  if (/\[완료\]|,\s*완료\)|완료\)$/.test(text)) return 'completed';
  if (/\[예정\]|,\s*예정\)|예정\)$|예정$/.test(text)) return 'planned';
  if (/\[진행\]|,\s*진행\)|진행\)$|~\d/.test(text)) return 'in_progress';
  if (/지연|블로킹|이슈|문제/.test(text)) return 'blocked';
  return 'in_progress';
}

function extractPhaseProgress(text) {
  const m = text.match(/Phase\s*\d+\s*진행율?\s*:\s*(\d{1,3})\s*%/i)
    || text.match(/진행율?\s*:\s*(\d{1,3})\s*%/i);
  return m ? parseInt(m[1]) : null;
}

function extractInlineProgress(text) {
  const m = text.match(/(\d{1,3})\s*%/);
  return m ? Math.min(100, parseInt(m[1])) : null;
}

function extractPeriod(title) {
  const m = title.match(/\((\d+\/\d+)\)/) || title.match(/(\d{2}\/\d{1,2}\/\d{1,2})/);
  return m ? m[1] : title;
}

function extractHighlights(text) {
  return text.split('\n')
    .filter(l => /완료\)|완료,|\[완료\]/.test(l) && l.length < 150)
    .slice(0, 6)
    .map(l => l.replace(/^[•*\-]+\s*/, '').replace(/\(.*?\)$/, '').trim())
    .filter(Boolean);
}

function extractIssues(text) {
  return text.split('\n')
    .filter(l => /지연|이슈|문제|딜레이|블로킹/.test(l) && l.length < 150)
    .slice(0, 5)
    .map(l => l.replace(/^[•*\-]+\s*/, '').trim())
    .filter(Boolean);
}

function extractNextPlans(text) {
  return text.split('\n')
    .filter(l => /예정\)|예정,|\[예정\]|예정$/.test(l) && l.length < 150)
    .slice(0, 5)
    .map(l => l.replace(/^[•*\-]+\s*/, '').trim())
    .filter(Boolean);
}

/**
 * 레이어 섹션을 파싱하여 task 목록 반환
 */
function parseLayerTasks(lines) {
  const tasks = [];
  let baseProgress = null;

  for (const line of lines) {
    const p = extractPhaseProgress(line);
    if (p !== null) { baseProgress = p; continue; }

    if (/^[•*\-]/.test(line) || line.length > 5) {
      const text = line.replace(/^[•*\-]+\s*/, '').trim();
      if (text.length < 5) continue;
      if (detectTopSection(text) || detectLayer(text)) continue; // 헤더 줄 건너뜀

      const status = detectStatus(text);
      const progress = status === 'completed' ? 100
        : status === 'planned' ? 0
        : extractInlineProgress(text) ?? baseProgress ?? 50;

      tasks.push({
        title: text.substring(0, 100).replace(/\s*\(.*?\)$/, '').trim(),
        status,
        progress,
        detail: text,
      });
    }
  }

  return tasks;
}

/**
 * AX1 주간업무 (날짜) 형식 파싱 → 레이어별 카테고리
 */
function parseAX1Format(text) {
  // 작성 방법 / 작성예시 섹션 제거 (첫 번째 실제 섹션까지)
  const firstSection = text.search(/AX플랫폼전략|AX사업기획|AX기술|AgenticOS|리서치/);
  const cleaned = firstSection > 0 ? text.substring(firstSection) : text;

  const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);

  // 각 레이어/섹션별로 줄 묶기
  const buckets = new Map(); // label → lines[]
  let currentTop = null;
  let currentLayer = null;

  for (const line of lines) {
    const top = detectTopSection(line);
    if (top) {
      currentTop = top;
      currentLayer = null;
      if (!buckets.has(top)) buckets.set(top, []);
      continue;
    }

    const layer = detectLayer(line);
    if (layer) {
      currentLayer = layer;
      if (!buckets.has(layer)) buckets.set(layer, []);
      const phaseProgress = extractPhaseProgress(line);
      if (phaseProgress !== null) {
        buckets.get(layer).push(`Phase 진행율 : ${phaseProgress}%`);
      }
      continue;
    }

    // 일반 내용 줄
    const target = currentLayer || currentTop;
    if (target && buckets.has(target)) {
      buckets.get(target).push(line);
    }
  }

  // 레이어 우선 순서 정렬
  const LAYER_ORDER = [
    'Runtime & Agent Gateway',
    'Agent Lifecycle',
    'Security & Governance',
    'Data & Integration',
    'Document Solution Agent',
    'User Layer',
    'Infrastructure',
    'AX플랫폼전략 (TFT 운영)',
    'AX사업기획',
    'AX기술',
    'AgenticOS',
    '리서치',
    '사업',
    '기타',
  ];

  const categories = [];

  for (const label of LAYER_ORDER) {
    if (!buckets.has(label)) continue;
    const sectionLines = buckets.get(label);
    const tasks = parseLayerTasks(sectionLines);
    if (tasks.length === 0) continue;

    const phaseProgressLine = sectionLines.find(l => /Phase 진행율/.test(l));
    const phaseProgress = phaseProgressLine ? extractPhaseProgress(phaseProgressLine) : null;
    const progress = phaseProgress
      ?? (tasks.length > 0
        ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length)
        : 50);

    categories.push({ name: label, tasks, progress });
  }

  return categories;
}

/**
 * 주간보고 텍스트 → 구조화 데이터
 */
export async function parseReport(text, title) {
  let categories = parseAX1Format(text);

  // 파싱 실패 시 폴백
  if (categories.length === 0) {
    const tasks = text.split('\n')
      .map(l => l.trim())
      .filter(l => /^[•*\-]/.test(l))
      .slice(0, 20)
      .map(l => {
        const t = l.replace(/^[•*\-]+\s*/, '').trim();
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
