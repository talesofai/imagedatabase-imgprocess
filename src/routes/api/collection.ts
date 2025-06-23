import { Hono } from 'hono';
import {
  createCollection,
  findCollectionById,
  findCollectionByName,
  createArtifactCollectionMap,
  findArtifactByPath,
  findArtifactById,
} from '../../db/index';

const app = new Hono<{ Bindings: Env }>();

interface CreateCollectionRequestBody {
  name: string;
  description?: string;
  creator_id?: string;
  cover_artifact_id?: string;
}

interface AddArtifactToCollectionRequestBody {
  collection_id: string;
  r2SourcePath?: string; // 可选的 R2 源路径
  imageId?: string; // 可选的 artifact ID
}

// 创建新的 collection
app.post('/', async (c) => {
  try {
    const body = await c.req.json<CreateCollectionRequestBody>();

    if (
      !body.name ||
      typeof body.name !== 'string' ||
      body.name.trim() === ''
    ) {
      return c.json(
        { error: 'name is required and must be a non-empty string' },
        400
      );
    }

    const currentTime = Date.now();
    const collectionId = crypto.randomUUID();
    const collectionRecord = {
      id: collectionId,
      name: body.name.trim(),
      description: body.description || undefined,
      create_time: currentTime,
      update_time: currentTime,
      creator_id: body.creator_id || undefined,
      cover_artifact_id: body.cover_artifact_id || undefined,
      is_deleted: false,
    };

    const savedCollection = await createCollection(c.env, collectionRecord);

    if (!savedCollection) {
      console.error('Failed to save collection to database');
      return c.json(
        {
          error: 'Failed to create collection',
          details: 'Database operation failed',
        },
        500
      );
    }

    return c.json(
      {
        success: true,
        collection: {
          id: collectionId,
          name: body.name.trim(),
          description: body.description || undefined,
          create_time: currentTime,
          creator_id: body.creator_id || undefined,
          cover_artifact_id: body.cover_artifact_id || undefined,
        },
        message: 'Collection created successfully',
      },
      200
    );
  } catch (error) {
    console.error('Error creating collection:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred';
    return c.json(
      { error: 'Internal server error', details: errorMessage },
      500
    );
  }
});

// 将 artifact 添加到 collection
app.post('/add-artifact', async (c) => {
  try {
    const body = await c.req.json<AddArtifactToCollectionRequestBody>();

    if (!body.collection_id) {
      return c.json({ error: 'collection_id is required' }, 400);
    }

    if (!body.r2SourcePath && !body.imageId) {
      return c.json(
        { error: 'Either r2SourcePath or imageId is required' },
        400
      );
    }

    if (body.r2SourcePath && body.imageId) {
      return c.json(
        { error: 'Only one of r2SourcePath or imageId should be provided' },
        400
      );
    }

    // 验证 collection 是否存在
    const collection = await findCollectionById(c.env, body.collection_id);
    if (!collection) {
      return c.json({ error: 'Collection not found' }, 404);
    } // 获取 artifact_id
    let artifact_id: string;
    if (body.imageId) {
      // 如果提供了 imageId，直接使用它作为 artifact_id
      artifact_id = body.imageId;
    } else if (body.r2SourcePath) {
      // 如果提供了路径，需要查找 artifact
      const artifact = await findArtifactByPath(c.env, body.r2SourcePath);
      if (!artifact) {
        return c.json({ error: 'Artifact not found for the given path' }, 404);
      }
      artifact_id = artifact.id;
    } else {
      return c.json(
        { error: 'Either r2SourcePath or imageId is required' },
        400
      );
    }

    // 创建 artifact-collection 映射
    const currentTime = Date.now();
    const mappingRecord = {
      artifact_id: artifact_id,
      collection_id: body.collection_id,
      add_time: currentTime,
    };

    const savedMapping = await createArtifactCollectionMap(
      c.env,
      mappingRecord
    );

    if (!savedMapping) {
      console.error('Failed to save artifact-collection mapping');
      return c.json(
        {
          error: 'Failed to add artifact to collection',
          details: 'Database operation failed',
        },
        500
      );
    }
    return c.json(
      {
        success: true,
        mapping: {
          artifact_id: artifact_id,
          collection_id: body.collection_id,
          add_time: currentTime,
        },
        message: 'Artifact added to collection successfully',
      },
      200
    );
  } catch (error) {
    console.error('Error adding artifact to collection:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred';
    return c.json(
      { error: 'Internal server error', details: errorMessage },
      500
    );
  }
});

export default app;
