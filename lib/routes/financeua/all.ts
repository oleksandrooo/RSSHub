import type { Route } from '@/types';
import got from '@/utils/got';

type ApiMarket = {
    ID: number;
    Title: string;
    URL: string;
    Slug: string;
};

type ApiItem = {
    ID: number;
    NewsTypeID: number;
    PublishTime: string;
    URL: string;
    Title: string;
    Descr?: string;
    CoverURL?: string;
    IsImportant?: boolean;
    Markets?: ApiMarket[];
};

type ApiResp = {
    data: ApiItem[];
    more: boolean;
    status: boolean;
    message?: string;
};

const escapeHtml = (s: string) =>
    s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJsonWithRetry<T>(url: string, tries = 4): Promise<T> {
    let lastErr: unknown;

    for (let i = 0; i < tries; i++) {
        try {
            const resp = await got<T>({
                method: 'get',
                url,
                headers: {
                    accept: 'application/json',
                    referer: 'https://news.finance.ua/',
                    origin: 'https://news.finance.ua',
                    'user-agent': 'RSSHub (+https://github.com/DIYgod/RSSHub)',
                    'accept-language': 'uk-UA,uk;q=0.9,en-US;q=0.7,en;q=0.6',
                },
                timeout: 30000,
            });

            return resp.data;
        } catch (e) {
            lastErr = e;
            await sleep(400 * 2 ** i);
        }
    }

    throw lastErr;
}

export const route: Route = {
    path: '/all',
    categories: ['finance', 'news'],
    example: '/financeua/all?lang=ua&limit=20',
    parameters: {
        option_id: 'опціонально: option_id (наприклад 18)',
        type_id: 'опціонально: type_id (наприклад 2)',
        lang: 'ua/ru/en (за замовчуванням ua)',
        limit: 'скільки елементів віддати (alias до max, за замовчуванням 60, максимум 300)',
        max: 'те саме, що limit',
        page_size: 'скільки брати за один запит (за замовчуванням 30, максимум 50)',
    },
    name: 'Finance.ua News (API): All',
    maintainers: ['oleksandrooo'],

    handler: async (ctx) => {
        // ❗️ВАЖЛИВО: НЕ СТАВИМО ДЕФОЛТІВ ДЛЯ option_id/type_id
        const option_id = ctx.req.query('option_id'); // string | null
        const type_id = ctx.req.query('type_id'); // string | null
        const lang = ctx.req.query('lang') ?? 'ua';

        // Підтримка limit (як ти використовуєш у URL) + старий max
        const maxRaw = ctx.req.query('limit') ?? ctx.req.query('max') ?? '60';
        const max = Math.max(1, Math.min(300, Number(maxRaw)));

        const pageSize = Math.max(1, Math.min(50, Number(ctx.req.query('page_size') ?? 30)));

        const baseApi = 'https://news-api.finance.ua/api/1.0/news/public/page-collection/all.class';

        let offset = 0;
        let more = true;
        let items: ApiItem[] = [];

        while (more && items.length < max) {
            const params = new URLSearchParams();
            params.set('limit', String(pageSize));
            params.set('offset', String(offset));
            params.set('lang', lang);

            // ✅ додаємо лише якщо реально передали
            if (option_id) params.set('option_id', option_id);
            if (type_id) params.set('type_id', type_id);

            const url = `${baseApi}?${params.toString()}`;

            const body = await fetchJsonWithRetry<ApiResp>(url, 4);

            if (!body?.status || !Array.isArray(body.data)) break;

            items = items.concat(body.data);
            more = Boolean(body.more);
            offset += pageSize;

            if (offset > 5000) break;
        }

        // дедуп по ID
        const seen = new Set<number>();
        const deduped: ApiItem[] = [];
        for (const it of items) {
            if (!seen.has(it.ID)) {
                seen.add(it.ID);
                deduped.push(it);
            }
        }

        const finalItems = deduped.slice(0, max);

        const site = 'https://news.finance.ua/';
        const feedTitleParts = [`Finance.ua (lang=${lang}`];
        if (option_id) feedTitleParts.push(`option_id=${option_id}`);
        if (type_id) feedTitleParts.push(`type_id=${type_id}`);
        feedTitleParts.push(')');
        const feedTitle = feedTitleParts.join(', ').replace(', )', ')');

        return {
            title: feedTitle,
            link: site,
            description: `news-api.finance.ua → RSS (${option_id ? `option_id=${option_id}, ` : ''}${type_id ? `type_id=${type_id}, ` : ''}lang=${lang})`,
            item: finalItems.map((it) => {
                const link = site + it.URL.replace(/^\/+/, '');

                const parts: string[] = [];
                if (it.CoverURL) {
                    parts.push(`<p><img referrerpolicy="no-referrer" src="${escapeHtml(it.CoverURL)}" /></p>`);
                }
                if (it.Descr) {
                    parts.push(`<p>${escapeHtml(it.Descr)}</p>`);
                }
                if (it.Markets?.length) {
                    const markets = it.Markets.map((m) => escapeHtml(m.Title)).join(', ');
                    parts.push(`<p><small>Рубрики: ${markets}</small></p>`);
                }

                return {
                    title: it.Title,
                    link,
                    guid: String(it.ID),
                    pubDate: it.PublishTime,
                    description: parts.join(''),
                };
            }),
        };
    },
};
