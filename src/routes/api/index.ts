import { Hono } from 'hono';
import process from './process';
import health from './health';
import caption from './caption';
import upload from './upload';
import collection from './collection';

const app = new Hono();

app.route('/v1/process', process);
app.route('/v1/health', health);
app.route('/v1/caption', caption);
app.route('/v1/upload', upload);
app.route('/v1/collection', collection);

export default app;
