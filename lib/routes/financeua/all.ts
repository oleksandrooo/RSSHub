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
    PublishTime: string; // ISO string with timezone
    Views?: number;
    URL: string; // e.g. "ua/...."
    Title: string;
    Descr?: string;
    CoverURL?: string;
    IsImportant?: boolean;
    Markets?: ApiMarket[];
};

type ApiResp = {
    data: ApiItem[];
    message?: string;
    more: boolean;
    status: boolean;
};

const escapeHtml = (s: string) =>
    s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');

export const route: Route = {
    path: '/all',
    categories: ['finance', 'news'],
    example: '/financeua/all?option_id=18&type_id=2&lang=ua&max=60',
    parameters: {
        option_id: 'option_id (у вас 18)',
        type_id: 'type_id (у вас 2)',
        lang: 'ua/ru/en (у вас ua)',
        max: 'скільки елементів віддати (за замовчуванням 60)',
        page_size: 'скільки брати за запит (за замовчуванням 6, як у вашому прикладі)',
    },
    name: 'Finance.ua News (API)',
    maintainers: ['oleksandrooo'],

    handler: async (ctx) => {
        const option_id = ctx.req.query('option_id') ?? '18';
        const type_id = ctx.req.query('type_id') ?? '2';
        const lang = ctx.req.query('lang') ?? 'ua';

        const max = Math.max(1, Math.min(500, Number(ctx.req.query('max') ?? 60))); // safety cap
        const pageSize = Math.max(1, Math.min(50, Number(ctx.req.query('page_size') ?? 6))); // safety cap

        const baseApi =
            'https://news-api.finance.ua/api/1.0/news/public/page-collection/all.class';

        let offset = 0;
        let more = true;
        let items: ApiItem[] = [];

        // збираємо до max елементів або поки more=false
        while (more && items.length < max) {
            const url =
                `${baseApi}?limit=${pageSize}&offset=${offset}` +
                `&option_id=${encodeURIComponent(option_id)}` +
                `&type_id=${encodeURIComponent(type_id)}` +
                `&lang=${encodeURIComponent(lang)}`;

            const resp = await got<ApiResp>({
                method: 'get',
                url,
                headers: {
                    accept: 'application/json',
                    // часто допомагає, якщо бекенд дивиться на походження
                    referer: 'https://news.finance.ua/',
                    origin: 'https://news.finance.ua',
                    // інколи захисти люблять user-agent
                    'user-agent': 'RSSHub (+https://github.com/DIYgod/RSSHub)',
                },
                timeout: {
                    request: 15000,
                },
            });

            const body = resp.data;

            if (!body?.status || !Array.isArray(body.data)) {
                // якщо API повернуло не те, що очікували — зупиняємось
                break;
            }

            items = items.concat(body.data);
            more = Boolean(body.more);

            offset += pageSize;
            if (offset > 10000) {
                // захист від нескінченного циклу
                break;
            }
        }

        // прибираємо можливі дублікати по ID (на всяк випадок)
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
        const feedTitle = `Finance.ua (option_id=${option_id}, type_id=${type_id}, lang=${lang})`;

        return {
            title: feedTitle,
            link: site,
            description: `JSON → RSS via news-api.finance.ua (option_id=${option_id}, type_id=${type_id}, lang=${lang})`,
            item: finalItems.map((it) => {
                const link = site + it.URL.replace(/^\/+/, '');

                const parts: string[] = [];

                if (it.CoverURL) {
                    parts.push(
                        `<p><img referrerpolicy="no-referrer" src="${escapeHtml(it.CoverURL)}" /></p>`
                    );
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
