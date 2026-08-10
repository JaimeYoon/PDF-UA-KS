import axios from 'axios';
import * as cheerio from 'cheerio';

export class ConfluenceClient {
  constructor() {
    const base = process.env.CONFLUENCE_BASE_URL?.replace(/\/$/, '');
    const auth = Buffer.from(
      `${process.env.CONFLUENCE_EMAIL}:${process.env.CONFLUENCE_API_TOKEN}`
    ).toString('base64');

    this.http = axios.create({
      baseURL: `${base}/rest/api`,
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    });

    this.parentPageId = process.env.CONFLUENCE_PARENT_PAGE_ID;
    this.baseUrl = base;
  }

  /** 부모 페이지의 하위 주간보고 목록 최신순 반환 (CQL 사용, 중첩 구조 지원) */
  async listWeeklyPages(limit = 20) {
    const cql = `ancestor = ${this.parentPageId} AND title ~ "주간 업무 보고" AND type = page ORDER BY lastmodified DESC`;
    try {
      const res = await this.http.get('/content/search', {
        params: { cql, limit, expand: 'version,history' },
      });
      const results = res.data.results || [];
      if (results.length > 0) {
        return results.map(p => ({
          id: p.id,
          title: p.title,
          lastModified: p.version?.when,
          author: p.version?.by?.displayName,
          url: `${this.baseUrl}/pages/viewpage.action?pageId=${p.id}`,
        }));
      }
    } catch (e) {
      // CQL 실패 시 직계 child 방식으로 폴백
    }

    const fallback = await this.http.get(`/content/${this.parentPageId}/child/page`, {
      params: { limit, expand: 'version,history', orderby: 'history.lastUpdated desc' },
    });
    return (fallback.data.results || []).map(p => ({
      id: p.id,
      title: p.title,
      lastModified: p.version?.when,
      author: p.version?.by?.displayName,
      url: `${this.baseUrl}/pages/viewpage.action?pageId=${p.id}`,
    }));
  }

  /** 페이지 본문 가져오기 (HTML → 정제 텍스트) */
  async getPageContent(pageId) {
    const res = await this.http.get(`/content/${pageId}`, {
      params: { expand: 'body.storage,version,history' },
    });
    const p = res.data;
    const html = p.body?.storage?.value || '';
    return {
      id: p.id,
      title: p.title,
      lastModified: p.version?.when,
      author: p.version?.by?.displayName || p.history?.createdBy?.displayName,
      plainText: this.#htmlToText(html),
      url: `${this.baseUrl}/pages/viewpage.action?pageId=${p.id}`,
    };
  }

  /** 최신 2개 페이지(이번주 + 지난주) 가져오기 */
  async getLatestTwo() {
    const pages = await this.listWeeklyPages(2);
    if (pages.length === 0) throw new Error('주간보고 하위 페이지가 없습니다.');

    const [current, previous] = await Promise.all([
      this.getPageContent(pages[0].id),
      pages[1] ? this.getPageContent(pages[1].id) : Promise.resolve(null),
    ]);
    return { current, previous, allPages: pages };
  }

  #htmlToText(html) {
    const $ = cheerio.load(html);

    // 테이블 → 텍스트
    $('table').each((_, tbl) => {
      const rows = [];
      $(tbl).find('tr').each((_, tr) => {
        const cells = [];
        $(tr).find('th,td').each((_, td) => cells.push($(td).text().trim()));
        if (cells.length) rows.push(cells.join(' | '));
      });
      $(tbl).replaceWith(rows.join('\n') + '\n');
    });

    $('li').each((_, li) => $(li).prepend('• '));
    $('h1,h2,h3,h4').each((_, h) => $(h).append('\n'));
    $('p,br').each((_, el) => $(el).append('\n'));

    return $.text().replace(/\n{3,}/g, '\n\n').trim();
  }
}
