import createClient from 'openapi-fetch';
import type { paths, components } from '../../petstore';

export function initClient(c: Env) {
  return createClient<paths>({ baseUrl: c.PGREST_URL });
}

export async function createArtifact(
  c: Env,
  body: components['schemas']['artifacts']
): Promise<components['schemas']['artifacts'] | null> {
  const client = initClient(c);
  const { data, error } = await client.POST('/artifacts', {
    headers: {
      Authorization: `Bearer ${c.PGREST_TOKEN}`,
    },
    body,
  });
  if (error) {
    console.error('Error creating artifact:', error);
    return null;
  }

  return body;
}
export async function findArtifactById(
  c: Env,
  id: string
): Promise<components['schemas']['artifacts'] | null> {
  const client = initClient(c);
  const { data, error } = await client.GET('/artifacts', {
    headers: {
      Authorization: `Bearer ${c.PGREST_TOKEN}`,
    },
    params: {
      query: {
        id: `eq.${id}`,
        limit: '1',
      },
    },
  });

  if (error) {
    console.error('Error finding artifact:', error);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  const artifactsArray = data as components['schemas']['artifacts'][];
  return artifactsArray[0] || null;
}
export async function findArtifactByPath(
  c: Env,
  originalPath: string
): Promise<components['schemas']['artifacts'] | null> {
  const client = initClient(c);
  const origin_md5 = originalPath.split('/').slice(3).join('/').split('.')[0];

  const { data, error } = await client.GET('/artifacts', {
    headers: {
      Authorization: `Bearer ${c.PGREST_TOKEN}`,
    },
    params: {
      query: {
        md5: `eq.${origin_md5}`,
        limit: '1',
      },
    },
  });

  if (error) {
    console.error('Error finding artifact:', error);
    return null;
  }
  const artifactsArray = data as components['schemas']['artifacts'][];

  if (!artifactsArray || artifactsArray.length === 0) {
    return null;
  }

  return artifactsArray[0] || null;
}

export async function findArtifactCaptionMap(
  c: Env,
  artifactId: string
): Promise<components['schemas']['artifact_caption_map'][] | null> {
  const client = initClient(c);
  const { data, error } = await client.GET('/artifact_caption_map', {
    headers: {
      Authorization: `Bearer ${c.PGREST_TOKEN}`,
    },
    params: {
      query: {
        artifact_id: `eq.${artifactId}`,
      },
    },
  });

  if (error) {
    console.error('Error finding artifact_caption_map:', error);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  const artifactCaptionMapArray =
    data as components['schemas']['artifact_caption_map'][];
  return artifactCaptionMapArray;
}

export async function updateArtifact(
  c: Env,
  id: string,
  updates: Partial<components['schemas']['artifacts']>
): Promise<boolean> {
  const client = initClient(c);
  const { error } = await client.PATCH('/artifacts', {
    headers: {
      Authorization: `Bearer ${c.PGREST_TOKEN}`,
    },
    params: {
      query: {
        id: `eq.${id}`,
      },
    },
    body: updates as components['schemas']['artifacts'],
  });

  if (error) {
    console.error('Error updating artifact:', error);
    return false;
  }

  return true;
}

export async function createCaption(
  c: Env,
  body: components['schemas']['captions']
): Promise<components['schemas']['captions'] | null> {
  const client = initClient(c);
  const { data, error } = await client.POST('/captions', {
    headers: {
      Authorization: `Bearer ${c.PGREST_TOKEN}`,
    },
    body,
  });

  if (error) {
    console.error('Error creating caption:', error);
    return null;
  }

  return body;
}

export async function findCaptionById(
  c: Env,
  id: string
): Promise<components['schemas']['captions'] | null> {
  const client = initClient(c);
  const { data, error } = await client.GET('/captions', {
    headers: {
      Authorization: `Bearer ${c.PGREST_TOKEN}`,
    },
    params: {
      query: {
        id: `eq.${id}`,
        limit: '1',
      },
    },
  });

  if (error) {
    console.error('Error finding caption:', error);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  const captionsArray = data as components['schemas']['captions'][];
  return captionsArray[0] || null;
}

export async function createArtifactCaptionMap(
  c: Env,
  body: components['schemas']['artifact_caption_map']
): Promise<components['schemas']['artifact_caption_map'] | null> {
  const client = initClient(c);
  const { data, error } = await client.POST('/artifact_caption_map', {
    headers: {
      Authorization: `Bearer ${c.PGREST_TOKEN}`,
    },
    body,
  });

  if (error) {
    console.error('Error creating artifact_caption_map:', error);
    return null;
  }

  return body;
}

export async function createCollection(
  c: Env,
  body: components['schemas']['collections']
): Promise<components['schemas']['collections'] | null> {
  const client = initClient(c);
  const { data, error } = await client.POST('/collections', {
    headers: {
      Authorization: `Bearer ${c.PGREST_TOKEN}`,
    },
    body,
  });

  if (error) {
    console.error('Error creating collection:', error);
    return null;
  }

  return body;
}

export async function findCollectionById(
  c: Env,
  id: string
): Promise<components['schemas']['collections'] | null> {
  const client = initClient(c);
  const { data, error } = await client.GET('/collections', {
    headers: {
      Authorization: `Bearer ${c.PGREST_TOKEN}`,
    },
    params: {
      query: {
        id: `eq.${id}`,
        limit: '1',
      },
    },
  });

  if (error) {
    console.error('Error finding collection:', error);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  const collection = data as components['schemas']['collections'][];
  if (!collection || collection.length === 0) {
    return null;
  }
  return collection[0] || null;
}

export async function findCollectionByName(
  c: Env,
  name: string
): Promise<components['schemas']['collections'] | null> {
  const client = initClient(c);
  const { data, error } = await client.GET('/collections', {
    headers: {
      Authorization: `Bearer ${c.PGREST_TOKEN}`,
    },
    params: {
      query: {
        name: `eq.${name}`,
        is_deleted: 'eq.false',
        limit: '1',
      },
    },
  });

  if (error) {
    console.error('Error finding collection by name:', error);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }
  const collection = data as components['schemas']['collections'][];
  if (!collection || collection.length === 0) {
    return null;
  }
  return collection[0] || null;
}

export async function createArtifactCollectionMap(
  c: Env,
  body: components['schemas']['artifact_collection_map']
): Promise<components['schemas']['artifact_collection_map'] | null> {
  const client = initClient(c);
  const { data, error } = await client.POST('/artifact_collection_map', {
    headers: {
      Authorization: `Bearer ${c.PGREST_TOKEN}`,
    },
    body,
  });

  if (error) {
    console.error('Error creating artifact_collection_map:', error);
    return null;
  }

  return body;
}
