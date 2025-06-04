import { Hono } from 'hono';
import { prettyJSON } from 'hono/pretty-json';
import routes from './routes';

const app = new Hono<{ Bindings: Env }>();
app.use('*', prettyJSON());
app.route('/', routes);

export default app;
