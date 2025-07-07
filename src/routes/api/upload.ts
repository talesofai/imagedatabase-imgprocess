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

// 辅助函数：处理 collection 关联
async function handleCollectionAssociation(
  env: Env,
  artifactId: string,
  collectionId: string | null,
  collectionName: string | null
) {
  let targetCollection = null;
  let isNewCollection = false;

  // 优先使用 collection_id
  if (
    collectionId &&
    typeof collectionId === 'string' &&
    collectionId.trim() !== ''
  ) {
    try {
      targetCollection = await findCollectionById(env, collectionId.trim());
    } catch (error) {
      console.warn(`Failed to find collection by ID: ${collectionId}`, error);
    }
  }

  // 如果没有通过ID找到collection，且提供了名称，则按名称查找或创建
  if (
    !targetCollection &&
    collectionName &&
    typeof collectionName === 'string' &&
    collectionName.trim() !== ''
  ) {
    try {
      targetCollection = await findCollectionByName(env, collectionName.trim());

      // 如果按名称没有找到，则创建新的 collection
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

        const savedCollection = await createCollection(env, collectionRecord);
        if (savedCollection) {
          targetCollection = collectionRecord;
          isNewCollection = true;
          console.log(`Created new collection: ${collectionName.trim()}`);
        }
      }
    } catch (error) {
      console.error('Error handling collection by name:', error);
    }
  }

  // 创建关联
  if (targetCollection) {
    try {
      const currentTime = Date.now();
      const mappingRecord = {
        artifact_id: artifactId,
        collection_id: targetCollection.id,
        add_time: currentTime,
      };

      const collectionMapping = await createArtifactCollectionMap(
        env,
        mappingRecord
      );
      if (collectionMapping) {
        return {
          collection_id: targetCollection.id,
          collection_name: targetCollection.name,
          added_to_collection: true,
          is_new_collection: isNewCollection,
          add_time: currentTime,
        };
      }
    } catch (error) {
      console.error('Error creating artifact-collection mapping:', error);
    }
  }

  return {
    added_to_collection: false,
    warning: 'Collection not found or failed to create association',
  };
}

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
    }

    // Get image dimensions and format
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

    // 首先检查文件是否已存在于数据库中
    let existingArtifact = null;
    try {
      existingArtifact = await findArtifactByPath(c.env, objectKey);
    } catch (findError) {
      console.warn('Error checking for existing artifact:', findError);
      // 继续执行，不阻止上传流程
    }

    // 如果文件已存在，处理 collection 关联并返回
    if (existingArtifact) {
      console.log('File already exists, handling collection association');

      // 处理 collection 关联
      let collectionResult = null;
      if (collectionId || collectionName) {
        try {
          const collectionAssociation = await handleCollectionAssociation(
            c.env,
            existingArtifact.id,
            collectionId,
            collectionName
          );
          collectionResult = collectionAssociation;
        } catch (collectionError) {
          console.error(
            'Error handling collection association for existing file:',
            collectionError
          );
        }
      }

      return c.json({
        success: true,
        r2Path: objectKey,
        artifactId: existingArtifact.id,
        imageInfo: {
          width: existingArtifact.width,
          height: existingArtifact.height,
          format: existingArtifact.format,
          size: existingArtifact.size,
          pixels: existingArtifact.pixels,
        },
        message: 'File already exists',
        ...(collectionResult && {
          collection_association: collectionResult,
        }),
      });
    }

    // 文件不存在，继续上传流程
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
    };

    // Create artifact in database
    const createdArtifact = await createArtifact(c.env, artifactPayload);
    if (!createdArtifact) {
      console.error(
        'Failed to create artifact in database. This may indicate a duplicate MD5 or database constraint violation.'
      );

      // 尝试查找是否已经存在相同的 artifact（可能是并发上传导致的）
      try {
        const existingArtifact = await findArtifactByPath(c.env, objectKey);
        if (existingArtifact) {
          console.log(
            'Found existing artifact after failed creation, likely due to concurrent upload'
          );

          // 处理 collection 关联
          let collectionResult = null;
          if (collectionId || collectionName) {
            try {
              collectionResult = await handleCollectionAssociation(
                c.env,
                existingArtifact.id,
                collectionId,
                collectionName
              );
            } catch (collectionError) {
              console.error(
                'Error handling collection for existing artifact:',
                collectionError
              );
            }
          }

          return c.json({
            success: true,
            r2Path: objectKey,
            artifactId: existingArtifact.id,
            imageInfo: {
              width: existingArtifact.width,
              height: existingArtifact.height,
              format: existingArtifact.format,
              size: existingArtifact.size,
              pixels: existingArtifact.pixels,
            },
            message: 'File already exists (detected after upload)',
            ...(collectionResult && {
              collection_association: collectionResult,
            }),
          });
        }
      } catch (findError) {
        console.error(
          'Error finding existing artifact after failed creation:',
          findError
        );
      }

      // 如果既无法创建也无法找到现有的 artifact，返回错误
      return c.json(
        {
          error: 'Failed to create artifact in database',
          details:
            'This may be due to a database constraint violation or connection issue',
        },
        500
      );
    }

    // 处理 collection 关联
    let collectionResult = null;
    if (collectionId || collectionName) {
      try {
        collectionResult = await handleCollectionAssociation(
          c.env,
          artifactPayload.id,
          collectionId,
          collectionName
        );
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
    });
  } catch (error: any) {
    console.error('Error uploading file:', error.message, error.stack);
    throw new HTTPException(500, {
      message: `Failed to upload file: ${error.message}`,
    });
  }
});

export default app;
