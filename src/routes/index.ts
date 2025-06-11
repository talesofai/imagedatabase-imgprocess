// index.ts
import { Hono } from 'hono';
import api from './api';
import arena from './arena';
const app = new Hono<{ Bindings: Env }>();

// 😃
app.route('/api', api);
app.route('/arena', arena);

export default app;
