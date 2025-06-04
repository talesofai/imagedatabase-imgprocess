import { Hono } from 'hono';
import process from './process';
import health from './health';
import caption from './caption'; // Import the new caption route
import upload from './upload'; // Import the new upload route
import collection from './collection'; // Import the new collection route

const app = new Hono();

app.route('/v1/process', process);
app.route('/v1/health', health);
app.route('/v1/caption', caption); // Add the caption route
app.route('/v1/upload', upload); // Add the upload route
app.route('/v1/collection', collection); // Add the collection route

export default app;
