import pixiv from './pixiv';
import { Hono } from 'hono';

const app = new Hono();

app.route('/pixiv', pixiv);

export default app;
