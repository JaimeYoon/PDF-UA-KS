/**
 * AX사업기획실 주간업무 형식 파서 (AX1 스페이스, ancestor 2063040683)
 * 레이어별 파싱: Runtime & Agent Gateway, Agent Lifecycle, Security & Governance,
 *   Data & Integration, Infrastructure, Document Solution Agent, User Layer
 *   + AX사업기획, AX기술 섹션
 */

const LAYER_PATTERNS = [
  { pattern: /Runtime\s*&\s*(?:Execution|Agent\s*Gateway)/i, label: 'Runtime & Agent Gateway' },
  { pattern: /Agent\s*Lifecycle/i, label: 'Agent Lifecycle' },
  { pattern: /Security\s*&\s*Governance|Identity\s*&\s*Access/i, label: 'Security & Governance' },
  { pattern: /Instr?[au]?\s*&\s*Data|Data\s*&\s*Integration/i, label: 'Data & Integration' },
  { pattern: /Infrastructure/i, label: 'Infrastructure' },
  { pattern: /Document\s*Solution\s*Agent/i, label: 'Document Solution Agent' },
  { pattern: /User\s*Layer/i, label: 'User Layer' },
];

function detectLayer(line) {
  for (const { pattern, label } of LAYER_PATTERNS) {
    if (pattern.test(line)) return label;
  }
  return null;
}

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

/** 날짜/상태 괄호, 인라인 URL 등 제거 → 핵심 업무명만 남김 */
function cleanTaskText(text) {
  return text
    .replace(/\s*\/\/\s+https?:\/\/\S+/g, '')             // URL 주석 제거
    .replace(/\s*\([~～]?\d+\/\d+[~～]\d+\/\d+,?\s*(?:진행|완료|예정|지연)?\)\s*$/g, '') // (날짜~날짜, 상태)
    .replace(/\s*\([~～]?\d+\/\d+,?\s*(?:진행|완료|예정|지연)\)\s*$/g, '')               // (~날짜, 상태)
    .replace(/\s*\(\d+\/\d+[~～]\d+\/\d+\)\s*$/g, '')     // (날짜~날짜)
    .trim();
}

/** 중요 완료 항목만 선별 (배포·구현·구축·연동 등 핵심 키워드 포함된 것만) */
function extractHighlights(text) {
  const SIGNIFICANT = /배포|구현|개발.*완료|완료.*개발|구축|연동|확정|출시|릴리즈|적용.*완료|완료.*적용/;
  return text.split('\n')
    .filter(l => /완료\)|완료,|\[완료\]/.test(l) && SIGNIFICANT.test(l) && l.length < 180)
    .slice(0, 5)
    .map(l => cleanTaskText(l.replace(/^[•*\-]+\s*/, '').replace(/^\[완료\]\s*/, '').trim()))
    .filter(s => s.length > 5);
}

/** 실질적인 이슈·리스크만 선별 (완료된 항목 제외) */
function extractIssues(text) {
  return text.split('\n')
    .filter(l =>
      /이슈|리스크|지연|블로킹|차단|문제|필요|미정|확인\s*필요|근무\s*대응/.test(l) &&
      !/완료\)|완료,|\[완료\]/.test(l) &&
      l.length < 180
    )
    .slice(0, 4)
    .map(l => cleanTaskText(l.replace(/^[•*\-]+\s*/, '').trim()))
    .filter(s => s.length > 5);
}

function extractNextPlans(text) {
  return text.split('\n')
    .filter(l => /예정\)|예정,|\[예정\]|예정$/.test(l) && l.length < 180)
    .slice(0, 5)
    .map(l => cleanTaskText(l.replace(/^[•*\-]+\s*/, '').replace(/^\[예정\]\s*/, '').trim()))
    .filter(s => s.length > 5);
}

/** 레이어 섹션 내 task 목록 파싱 */
function parseLayerTasks(lines) {
  const tasks = [];
  let baseProgress = null;

  for (const line of lines) {
    const p = extractPhaseProgress(line);
    if (p !== null) { baseProgress = p; continue; }

    const raw = line.replace(/^[•*\-]+\s*/, '').trim();
    if (raw.length < 5) continue;
    if (detectTopSection(raw) || detectLayer(raw)) continue;
    if (/^각\s*레이어|^공통$/.test(raw)) continue; // 구분자 줄 건너뜀

    const cleaned = cleanTaskText(raw);
    if (cleaned.length < 5) continue;

    const status = detectStatus(raw);
    const progress = status === 'completed' ? 100
      : status === 'planned' ? 0
      : extractInlineProgress(raw) ?? baseProgress ?? 50;

    tasks.push({ title: cleaned.substring(0, 80), status, progress, detail: cleaned });
  }

  return tasks;
}

/**
 * AX1 주간업무 (날짜) 형식 파싱 → 레이어별 카테고리
 * AX플랫폼전략 (TFT 운영) 자체는 카테고리로 노출하지 않고 하위 레이어만 노출
 */
function parseAX1Format(text) {
  const firstSection = text.search(/AX플랫폼전략|AX사업기획|AX기술|AgenticOS|리서치/);
  const cleaned = firstSection > 0 ? text.substring(firstSection) : text;

  const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);

  const buckets = new Map();
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
      const pp = extractPhaseProgress(line);
      if (pp !== null) buckets.get(layer).push(`Phase 진행율 : ${pp}%`);
      continue;
    }

    const target = currentLayer || currentTop;
    if (target && buckets.has(target)) {
      buckets.get(target).push(line);
    }
  }

  // 출력 순서: AX플랫폼전략 (TFT 운영)은 제외, 레이어만 표시
  const LAYER_ORDER = [
    'Runtime & Agent Gateway',
    'Agent Lifecycle',
    'Security & Governance',
    'Data & Integration',
    'Infrastructure',
    'Document Solution Agent',
    'User Layer',
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

export async function parseReport(text, title) {
  let categories = parseAX1Format(text);

  if (categories.length === 0) {
    const tasks = text.split('\n')
      .map(l => l.trim())
      .filter(l => /^[•*\-]/.test(l))
      .slice(0, 20)
      .map(l => {
        const t = cleanTaskText(l.replace(/^[•*\-]+\s*/, '').trim());
        const status = detectStatus(l);
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
