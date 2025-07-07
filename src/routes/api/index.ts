import { Hono } from 'hono';
import process from './process';
import health from './health';
import caption from './caption';
import upload from './upload';
import collection from './collection';

import pics from './pics/index';

const app = new Hono<{ Bindings: Env }>();
app.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace(/^Bearer\s/, '');
  if (!token || token !== c.env.TOKEN) {
    return c.json({ error: 'Unauthorized: Invalid or missing token' }, 401);
  }
  await next();
});

app.route('/v1/process', process);
app.route('/v1/health', health);
app.route('/v1/caption', caption);
app.route('/v1/upload', upload);
app.route('/v1/collection', collection);

app.route('/v1/pics', pics);

export default app;
