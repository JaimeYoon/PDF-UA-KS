import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Confluence REST API 클라이언트
 * Cloud(Basic Auth: email+token) 및 Server(username+password or PAT) 모두 지원
 */
export class ConfluenceClient {
  constructor(config) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.type = config.type || 'cloud'; // 'cloud' | 'server'

    const auth = this.type === 'cloud'
      ? Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')
      : Buffer.from(`${config.username}:${config.password}`).toString('base64');

    this.http = axios.create({
      baseURL: `${this.baseUrl}/rest/api`,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Atlassian-Token': 'no-check',
      },
    });
  }

  /** 스페이스 내 페이지 목록 조회 (제목 검색) */
  async searchPages({ spaceKey, titlePattern, limit = 50 }) {
    const cql = `space="${spaceKey}" AND title~"${titlePattern}" AND type=page ORDER BY created DESC`;
    const res = await this.http.get('/content/search', {
      params: { cql, limit, expand: 'version,history,metadata.labels' },
    });
    return res.data.results;
  }

  /** 특정 페이지 본문(storage format → plain text) 조회 */
  async getPageContent(pageId) {
    const res = await this.http.get(`/content/${pageId}`, {
      params: { expand: 'body.storage,version,history,ancestors' },
    });
    const page = res.data;
    const html = page.body?.storage?.value || '';
    const plainText = this.htmlToText(html);
    return {
      id: page.id,
      title: page.title,
      version: page.version?.number,
      createdAt: page.history?.createdDate,
      lastModified: page.version?.when,
      author: page.version?.by?.displayName || page.history?.createdBy?.displayName,
      plainText,
      html,
      url: `${this.baseUrl}/pages/viewpage.action?pageId=${page.id}`,
    };
  }

  /** 특정 페이지의 이전 버전 본문 조회 */
  async getPageVersion(pageId, versionNumber) {
    const res = await this.http.get(`/content/${pageId}/version/${versionNumber}`, {
      params: { expand: 'content.body.storage' },
    });
    const html = res.data.content?.body?.storage?.value || '';
    return this.htmlToText(html);
  }

  /** 스페이스 내 모든 페이지 버전 히스토리 */
  async getPageVersions(pageId) {
    const res = await this.http.get(`/content/${pageId}/version`, {
      params: { limit: 10 },
    });
    return res.data.results;
  }

  /** Confluence Storage Format HTML → 사람이 읽을 수 있는 텍스트 변환 */
  htmlToText(html) {
    const $ = cheerio.load(html);

    // 테이블을 구조화된 텍스트로 변환
    $('table').each((_, table) => {
      const rows = [];
      $(table).find('tr').each((_, tr) => {
        const cells = [];
        $(tr).find('th, td').each((_, td) => {
          cells.push($(td).text().trim());
        });
        if (cells.length) rows.push(cells.join(' | '));
      });
      $(table).replaceWith(rows.join('\n') + '\n');
    });

    // 리스트 항목
    $('li').each((_, li) => {
      $(li).prepend('• ');
    });

    // 헤딩에 구분자 추가
    $('h1,h2,h3,h4').each((_, h) => {
      $(h).append('\n');
    });

    // 단락 구분
    $('p, div, br').each((_, el) => {
      $(el).append('\n');
    });

    return $.text()
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** 주간보고 페이지들을 날짜 기준으로 정렬하여 조회 */
  async getWeeklyReports({ spaceKey, titlePattern, limit = 20 }) {
    const pages = await this.searchPages({ spaceKey, titlePattern, limit });

    const reports = [];
    for (const page of pages) {
      const content = await this.getPageContent(page.id);
      reports.push(content);
    }

    // 최신순 정렬
    reports.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    return reports;
  }

  /** 특정 스페이스 내 하위 페이지(팀원별 보고) 조회 */
  async getChildPages(parentPageId) {
    const res = await this.http.get(`/content/${parentPageId}/child/page`, {
      params: { expand: 'version,history', limit: 50 },
    });
    return res.data.results;
  }

  /** Confluence 스페이스 목록 조회 */
  async listSpaces() {
    const res = await this.http.get('/space', {
      params: { limit: 50, type: 'global' },
    });
    return res.data.results;
  }
}
