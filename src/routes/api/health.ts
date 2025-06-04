import { Hono } from 'hono';

const app = new Hono();

app.all('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'Health check passed',
    timestamp: new Date().toISOString(),
  });
});

export default app;
