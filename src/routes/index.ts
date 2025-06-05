// index.ts
import { Hono } from 'hono';
import api from './api';
const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace(/^Bearer\s/, '');
  if (!token || token !== c.env.TOKEN) {
    return c.json({ error: 'Unauthorized: Invalid or missing token' }, 401);
  }
  await next();
});

// 😃
app.route('/api', api);

export default app;
