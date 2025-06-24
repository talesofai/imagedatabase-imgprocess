import { Hono } from 'hono';
import { env } from 'hono/adapter';
import { HTTPException } from 'hono/http-exception';
import { md5 } from 'hono/utils/crypto';
import {
  createArtifact,
  findCollectionById,
  findCollectionByName,
  findArtifactByPath,
  createCollection,
  createArtifactCollectionMap,
} from '../../db';
import { components } from '../../../petstore';
import imageSize from 'image-size';

const app = new Hono<{ Bindings: Env }>();

app.post('/', async (c) => {
  const { IMAGE_BUCKET } = env(c);
  if (!IMAGE_BUCKET) {
    console.error(
      'IMAGE_BUCKET is not configured in environment for direct upload.'
    );
    throw new HTTPException(500, {
      message: 'R2 bucket not configured on server',
    });
  }
  try {
    const formData = await c.req.formData();
    const file = formData.get('imageFile') as File | null;
    const fileName = formData.get('fileName') as string | null;
    const collectionId = formData.get('collection_id') as string | null; // 可选的 collection ID
    const collectionName = formData.get('collection_name') as string | null; // 可选的 collection 名称

    if (!file) {
      return c.json({ error: 'imageFile is required in FormData' }, 400);
    }
    if (!fileName || typeof fileName !== 'string' || fileName.trim() === '') {
      return c.json(
        { error: 'fileName is required and must be a non-empty string' },
        400
      );
    }

    // original/02/00/02000e6b9c70a21cfc590ce3d936ec8c.png
    const fileBuffer = await file.arrayBuffer();
    const file_md5_hash = await md5(fileBuffer);
    if (!file_md5_hash) {
      throw new HTTPException(500, {
        message: 'Failed to generate MD5 hash for the file.',
      });
    } // Get image dimensions and format
    const imageInfo = imageSize(new Uint8Array(fileBuffer));
    if (!imageInfo.width || !imageInfo.height || !imageInfo.type) {
      throw new HTTPException(400, {
        message: 'Invalid image file or unable to read image metadata.',
      });
    }

    const firstTwoChars = file_md5_hash.substring(0, 2);
    const nextTwoChars = file_md5_hash.substring(2, 4);
    const extension =
      fileName.split('.').pop()?.toLowerCase() || imageInfo.type || 'jpg';
    const objectKey = `original/${firstTwoChars}/${nextTwoChars}/${file_md5_hash}.${extension}`;

    await (IMAGE_BUCKET as any).put(objectKey, fileBuffer, {
      httpMetadata: {
        contentType: file.type || 'image/jpeg',
      },
    });

    const currentTime = new Date().getTime();
    const pixels = imageInfo.width * imageInfo.height;
    const artifactPayload: components['schemas']['artifacts'] = {
      id: crypto.randomUUID(),
      upload_time: currentTime,
      update_time: currentTime,
      width: imageInfo.width,
      height: imageInfo.height,
      size: fileBuffer.byteLength,
      pixels: pixels,
      format: imageInfo.type,
      md5: file_md5_hash,
      origin_name: fileName,
      created_time: currentTime,
      has_alpha: imageInfo.type === 'png' || imageInfo.type === 'gif',
      original_path: objectKey,
      is_deleted: false,
      is_resized: false,
    }; // Create artifact in database
    try {
      await createArtifact(c.env, artifactPayload);
    } catch (dbError) {
      console.error('Error creating artifact:', dbError);
      // 判断md5是否已存在
      const existingArtifact = await findArtifactByPath(c.env, objectKey);
      if (existingArtifact && collectionId) {
        const collection_map = {
          artifact_id: existingArtifact.id,
          collection_id: collectionId,
          add_time: Date.now(),
        };
        const collectionMapping = await createArtifactCollectionMap(
          c.env,
          collection_map
        );
        if (!collectionMapping) {
          throw new HTTPException(500, {
            message: 'Failed to create artifact-collection mapping.',
          });
        }
        return c.json({
          success: true,
          r2Path: objectKey,
          artifactId: existingArtifact.id,
          message: 'File already exists, added to collection successfully.',
          collection_association: {
            collection_id: collectionId,
            added_to_collection: true,
            add_time: collection_map.add_time,
          },
        });
      } else if (existingArtifact) {
        return c.json({
          success: true,
          r2Path: objectKey,
          artifactId: existingArtifact.id,
          message: 'File already exists, no collection association made.',
        });
      }
      throw new HTTPException(500, {
        message: 'Failed to create artifact in database.',
      });
    } // 处理 collection 关联 - 支持通过 ID 或名称
    let collectionMapping = null;
    let collectionResult = null;
    let isNewCollection = false;

    // 优先使用 collection_id，其次使用 collection_name
    const shouldProcessCollection =
      (collectionId &&
        typeof collectionId === 'string' &&
        collectionId.trim() !== '') ||
      (collectionName &&
        typeof collectionName === 'string' &&
        collectionName.trim() !== '');

    if (shouldProcessCollection) {
      try {
        let targetCollection = null;

        // 如果提供了 collection_id，优先使用 ID 查找
        if (
          collectionId &&
          typeof collectionId === 'string' &&
          collectionId.trim() !== ''
        ) {
          targetCollection = await findCollectionById(
            c.env,
            collectionId.trim()
          );
          if (!targetCollection) {
            console.warn(`Collection not found for ID: ${collectionId}`);
          }
        }

        // 如果没有通过ID找到collection，且提供了名称，则按名称查找或创建
        if (
          !targetCollection &&
          collectionName &&
          typeof collectionName === 'string' &&
          collectionName.trim() !== ''
        ) {
          targetCollection = await findCollectionByName(
            c.env,
            collectionName.trim()
          ); // 如果按名称没有找到，则创建新的 collection
          if (!targetCollection) {
            const currentTime = Date.now();
            const newCollectionId = crypto.randomUUID();
            const collectionRecord = {
              id: newCollectionId,
              name: collectionName.trim(),
              description: `由系统自动创建的集合: ${collectionName.trim()}`,
              create_time: currentTime,
              update_time: currentTime,
              cover_artifact_id: undefined,
              is_deleted: false,
            };

            const savedCollection = await createCollection(
              c.env,
              collectionRecord
            );
            if (savedCollection) {
              targetCollection = collectionRecord;
              isNewCollection = true;
              console.log(`Created new collection: ${collectionName.trim()}`);
            } else {
              console.error('Failed to create new collection');
            }
          }
        }

        // 如果找到或创建了 collection，则创建关联
        if (targetCollection) {
          const currentTime = Date.now();
          const mappingRecord = {
            artifact_id: artifactPayload.id,
            collection_id: targetCollection.id,
            add_time: currentTime,
          };

          collectionMapping = await createArtifactCollectionMap(
            c.env,
            mappingRecord
          );
          if (collectionMapping) {
            collectionResult = {
              collection_id: targetCollection.id,
              collection_name: targetCollection.name,
              added_to_collection: true,
              is_new_collection: isNewCollection,
              add_time: currentTime,
            };
          } else {
            console.warn('Failed to create artifact-collection mapping');
          }
        }
      } catch (collectionError) {
        console.error(
          'Error handling collection association:',
          collectionError
        );
        // 不抛出错误，因为文件已经成功上传
      }
    }
    return c.json({
      success: true,
      r2Path: objectKey,
      artifactId: artifactPayload.id,
      imageInfo: {
        width: imageInfo.width,
        height: imageInfo.height,
        format: imageInfo.type,
        size: fileBuffer.byteLength,
        pixels: pixels,
      },
      message: 'File uploaded successfully',
      ...(collectionResult && {
        collection_association: collectionResult,
      }),
      ...(shouldProcessCollection &&
        !collectionResult && {
          collection_association: {
            added_to_collection: false,
            warning: 'Collection not found or failed to create association',
          },
        }),
    });
  } catch (error: any) {
    console.error('Error uploading file:', error.message, error.stack);
    throw new HTTPException(500, {
      message: `Failed to upload file: ${error.message}`,
    });
  }
});

export default app;
