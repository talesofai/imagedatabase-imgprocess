import { Hono } from 'hono';
import { initClient } from '../db';
import { components } from '../../petstore';
import { createArtifact } from '../db';

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
  const client = initClient(c.env);
  const { data, error } = await client.GET('/artifacts', {
    headers: {
      Authorization: `Bearer ${c.env.PGREST_TOKEN}`,
    },
    params: {
      query: {
        limit: '100',
        origin_name: 'like(all).{danbooru*,*jpg}',
      },
    },
  });
  if (error) {
    console.error('Error fetching artifacts:', error);
    return c.json({ error: 'Failed to fetch artifacts' }, 500);
  }
  return c.json(data);
});

app.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) {
    return c.json({ error: 'ID is required' }, 400);
  }

  const client = initClient(c.env);
  const { data, error } = await client.GET('/artifacts', {
    headers: {
      Authorization: `Bearer ${c.env.PGREST_TOKEN}`,
    },
    params: {
      query: {
        id: `eq.${id}`,
      },
    },
  });

  if (error) {
    console.error(`Error fetching artifact with ID ${id}:`, error);
    return c.json({ error: `Failed to fetch artifact with ID ${id}` }, 500);
  }

  if (!data || data.length === 0) {
    return c.json({ error: 'Artifact not found' }, 404);
  }

  return c.json(data[0]);
});

app.post('/', async (c) => {
  const body = await c.req.json<components['schemas']['artifacts']>();
  if (!body) {
    return c.json({ error: 'error' }, 400);
  }
  const client = initClient(c.env);
  const { data, error } = await client.POST('/artifacts', {
    headers: {
      Authorization: `Bearer ${c.env.PGREST_TOKEN}`,
    },
    body,
  });
  if (error) {
    console.error('Error creating artifact:', error);
    return c.json({ error: 'Failed to create artifact' }, 500);
  }
  return c.json(
    { success: true, message: 'Artifact created successfully', data: body },
    201
  );
});

app.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) {
    return c.json({ error: 'ID is required' }, 400);
  }
  const body = await c.req.json<components['schemas']['artifacts']>();
  if (!body) {
    return c.json({ error: 'error' }, 400);
  }
  const client = initClient(c.env);
  const { data, error } = await client.PATCH('/artifacts', {
    headers: {
      Authorization: `Bearer ${c.env.PGREST_TOKEN}`,
    },
    params: {
      query: {
        id: `eq.${id}`,
      },
    },
    body: body,
  });
  if (error) {
    console.error(`Error updating artifact with ID ${id}:`, error);
    return c.json(
      { error: error, message: `Error updating artifact with ID ${id}` },
      500
    );
  }
  return c.json(
    { success: true, message: 'Artifact updated successfully', data: body },
    200
  );
});
export default app;
