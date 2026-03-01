import type { Route } from '@/types';
import got from '@/utils/got';

type ApiItem = {
    ID: number;
    PublishTime: string;
    URL: string;
    Title: string;
    Descr?: string;
    CoverURL?: string;
};

type ApiResp = {
    data: ApiItem[];
    more: boolean;
    status: boolean;
};

export const route: Route = {
    path: '/financeua/all',
    categories: ['finance', 'news'],
    example: '/financeua/all?option_id=18&type_id=2&lang=ua&max=60',
    parameters: {
        option_id: 'option_id (у вас 18)',
        type_id: 'type_id (у вас 2)',
        lang: 'ua/ru/en (у вас ua)',
        max: 'скільки елементів віддати (за замовчуванням 60)',
    },
    handler: async (ctx) => {
        const option_id = ctx.req.query('option_id') ?? '18';
        const type_id = ctx.req.query('type_id') ?? '2';
        const lang = ctx.req.query('lang') ?? 'ua';
        const max = Number(ctx.req.query('max') ?? 60);

        const limit = 6; // як у вашому запиті
        let offset = 0;
        let items: ApiItem[] = [];
        let more = true;

        while (more && items.length < max) {
            const url = `https://news-api.finance.ua/api/1.0/news/public/page-collection/all.class` +
                `?limit=${limit}&offset=${offset}&option_id=${option_id}&type_id=${type_id}&lang=${lang}`;

            const resp = await got<ApiResp>({
                method: 'get',
                url,
                headers: {
                    accept: 'application/json',
                    // інколи корисно підставити referer/origin, якщо API це перевіряє
                    referer: 'https://news.finance.ua/',
                    origin: 'https://news.finance.ua',
                },
            });

            const body = resp.data;
            if (!body?.status || !Array.isArray(body.data)) {
                break;
            }

            items = items.concat(body.data);
            more = Boolean(body.more);
            offset += limit;

            // захист від нескінченного циклу
            if (offset > 5000) break;
        }

        items = items.slice(0, max);

        const site = 'https://news.finance.ua/';
        const feedLink = `${site}${lang}/`; // умовно
        const title = `Finance.ua (option_id=${option_id}, type_id=${type_id}, lang=${lang})`;

        ctx.state.data = {
            title,
            link: feedLink,
            item: items.map((it) => {
                const link = site + it.URL.replace(/^\/+/, '');
                const img = it.CoverURL ? `<p><img src="${it.CoverURL}" /></p>` : '';
                const descr = it.Descr ? `<p>${it.Descr}</p>` : '';

                return {
                    title: it.Title,
                    link,
                    guid: String(it.ID),
                    pubDate: it.PublishTime,
                    description: `${img}${descr}`,
                };
            }),
        };
    },
};
