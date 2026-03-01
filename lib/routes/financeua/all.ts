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
    URL: string; // e.g. "ua/...."
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

export const route: Route = {
    path: '/all',
    categories: ['finance', 'news'],
    example: '/financeua/all?option_id=18&type_id=2&lang=ua&max=60&page_size=30',
    parameters: {
        option_id: 'option_id (у вас 18)',
        type_id: 'type_id (у вас 2)',
        lang: 'ua/ru/en (у вас ua)',
        max: 'скільки елементів віддати (за замовчуванням 60)',
        page_size: 'скільки брати за запит (за замовчуванням 30, щоб було менше запитів)',
    },
    name: 'Finance.ua News (API)',
    maintainers: ['oleksandrooo'],

    handler: async (ctx) => {
        const option_id = ctx.req.query('option_id') ?? '18';
        const type_id = ctx.req.query('type_id') ?? '2';
        const lang = ctx.req.query('lang') ?? 'ua';

        // Скільки елементів віддавати в RSS (не "всі назавжди", а останні N)
        const max = Math.max(1, Math.min(300, Number(ctx.req.query('max') ?? 60)));

        // Зменшуємо кількість HTTP-запитів: просимо більше за раз.
        // Якщо API не дозволяє великі limit — зменшіть до 10/6.
        const pageSize = Math.max(1, Math.min(50, Number(ctx.req.query('page_size') ?? 30)));

        const baseApi = 'https://news-api.finance.ua/api/1.0/news/public/page-collection/all.class';

        // Робимо got-інстанс з довшим таймаутом + ретраями
        const client = got.extend({
            headers: {
                accept: 'application/json',
                referer: 'https://news.finance.ua/',
                origin: 'https://news.finance.ua',
                'user-agent': 'RSSHub (+https://github.com/DIYgod/RSSHub)',
                'accept-language': 'uk-UA,uk;q=0.9,en-US;q=0.7,en;q=0.6',
            },
            // важливо: у got для RSSHub найнадійніше задавати timeout як number (мс)
            timeout: 30000, // 30s
            retry: {
                limit: 3,
                methods: ['GET'],
                statusCodes: [408, 413, 429, 500, 502, 503, 504],
                errorCodes: [
                    'ETIMEDOUT',
                    'ECONNRESET',
                    'EAI_AGAIN',
                    'ECONNREFUSED',
                    'ENOTFOUND',
                    'ERR_SOCKET_TIMEOUT',
                ],
            },
            // щоб не було “вічного” очікування
            throwHttpErrors: true,
        });

        let offset = 0;
        let more = true;
        let items: ApiItem[] = [];

        // Пагінація: збираємо до max або поки more=false
        while (more && items.length < max) {
            const url =
                `${baseApi}?limit=${pageSize}&offset=${offset}` +
                `&option_id=${encodeURIComponent(option_id)}` +
                `&type_id=${encodeURIComponent(type_id)}` +
                `&lang=${encodeURIComponent(lang)}`;

            const resp = await client.get(url).json<ApiResp>();

            if (!resp?.status || !Array.isArray(resp.data)) {
                break;
            }

            items = items.concat(resp.data);
            more = Boolean(resp.more);
            offset += pageSize;

            // запобіжник
            if (offset > 5000) break;
        }

        // Дедуп за ID (про всяк випадок)
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
            description: `news-api.finance.ua → RSS (option_id=${option_id}, type_id=${type_id}, lang=${lang})`,
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
