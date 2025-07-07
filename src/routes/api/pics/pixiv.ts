import { Hono } from 'hono';

const app = new Hono();

app.get('/', async (c) => {
  try {
    const page = c.req.query('page') || '1';
    const perPage = c.req.query('per_page') || '20';
    const keyword = c.req.query('keyword') || '';

    // Pixiv ranking endpoint (doesn't require authentication for public rankings)
    const rankingUrl = `https://www.pixiv.net/ranking.php?mode=daily&format=json&p=${page}`;

    const response = await fetch(rankingUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://www.pixiv.net/',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = (await response.json()) as {
      contents?: Array<{
        illust_id: string;
        title: string;
        user_id: string;
        user_name: string;
        url: string;
        tags?: string[];
        illust_upload_timestamp: string;
        view_count: number;
        yes_count: number;
      }>;
      next?: boolean;
    };

    // Transform Pixiv data to our format
    const transformedData = {
      illusts:
        data.contents?.map((item: any) => ({
          id: item.illust_id,
          title: item.title,
          user: {
            id: item.user_id,
            name: item.user_name,
          },
          image_urls: {
            square_medium: item.url,
            medium: item.url.replace(
              '_p0_square1200.jpg',
              '_p0_master1200.jpg'
            ),
            large: item.url.replace('_p0_square1200.jpg', '_p0.jpg'),
          },
          tags: item.tags || [],
          create_date: item.illust_upload_timestamp,
          view_count: item.view_count,
          bookmark_count: item.yes_count,
        })) || [],
      next_url: data.next ? `?page=${parseInt(page) + 1}` : null,
    };

    return c.json({
      success: true,
      data: transformedData,
      page: parseInt(page),
      per_page: parseInt(perPage),
    });
  } catch (error) {
    console.error('Error fetching Pixiv data:', error);
    return c.json(
      {
        success: false,
        error: 'Failed to fetch Pixiv data',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

export default app;
