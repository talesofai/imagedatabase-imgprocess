import { Hono } from 'hono';
import { getResize } from '../../service/resize';
import { uploadImageToR2 } from '../../service/upload';
import { findArtifactByPath, updateArtifact } from '../../db';

const app = new Hono<{ Bindings: Env }>();

// 请求体接口
interface RequestBody {
  r2SourcePath: string;
}

app.post('/', async (c) => {
  try {
    const body = await c.req.json<RequestBody>();
    const imageUrl = `https://${c.env.R2_DOMAIN}/${body.r2SourcePath}`;

    if (!imageUrl) {
      return c.json({ error: 'r2SourcePath is required' }, 400);
    }

    // 1. 获取图片
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return c.json(
        {
          error: `Failed to fetch image: ${imageResponse.statusText}`,
        },
        imageResponse.status as any
      );
    }
    const imageMimeType =
      imageResponse.headers.get('content-type') || 'image/jpeg';
    // 定义 objectKey，但先不上传原始图片
    const r2path = body.r2SourcePath;
    let extension = imageMimeType.split('/')[1];
    if (extension === 'jpeg') {
      extension = 'jpg';
    }
    const originalImageObjectKey = r2path.split('.')[0] || r2path; // 确保有一个默认值
    //去除第一个前缀
    const file_name = originalImageObjectKey.split('/').slice(1).join('/');
    // 2. 调整大小并上传不同尺寸的图片
    const shortSizeArray = ['256', '1024', '2048'];

    // 阶段 2.a: 调整所有尺寸的图片
    // 我们需要将 shortSize 与调整后的图像数据关联起来
    const resizePromises = shortSizeArray.map(async (shortSize) => {
      const imgBuffer = await getResize(imageUrl, shortSize);
      return { shortSize, imgBuffer }; // 返回包含尺寸和图像数据的对象
    });

    let resizedImageResults;
    try {
      resizedImageResults = await Promise.all(resizePromises);
      // console.log('All images resized successfully.');
    } catch (resizeError) {
      console.error('Error during image resizing phase:', resizeError);
      // 如果任何一个 getResize 失败，则抛出错误，阻止后续上传
      throw new Error(
        `Failed to resize one or more images: ${
          resizeError instanceof Error ? resizeError.message : resizeError
        }`
      );
    }

    // 阶段 2.b: 如果所有调整大小都成功，则上传调整大小后的图片
    let uploadedImages: string[] = [];
    const uploadResizedImagePromises = resizedImageResults.map(
      async (result) => {
        return uploadImageToR2(
          c.env,
          Promise.resolve(result.imgBuffer),
          file_name,
          'webp',
          result.shortSize
        );
      }
    );
    try {
      uploadedImages = await Promise.all(uploadResizedImagePromises);
      // 查找并更新 artifact 记录
      const artifact = await findArtifactByPath(c.env, r2path);
      if (!artifact) {
        console.error('Artifact not found for path:', r2path);
        throw new Error('Artifact not found for the given path');
      }

      // 构建更新对象，包含不同尺寸的路径
      const resizedPaths: { [key: string]: string } = {};
      uploadedImages.forEach((imagePath, index) => {
        const size = shortSizeArray[index];
        const pathOnly = imagePath.replace(`https://${c.env.R2_DOMAIN}/`, '');
        resizedPaths[`size_${size}x_path`] = pathOnly;
      });

      const updates = {
        is_resized: true,
        update_time: new Date().getTime(),
        ...resizedPaths,
      };

      const updateSuccess = await updateArtifact(c.env, artifact.id, updates);
      if (!updateSuccess) {
        throw new Error('Failed to update artifact record');
      }

      console.log('Successfully updated artifact with resized image paths');
    } catch (uploadError) {
      console.error('Error during upload of resized images:', uploadError);

      throw new Error(
        `Failed to upload one or more resized images: ${
          uploadError instanceof Error ? uploadError.message : uploadError
        }`
      );
    }

    return c.json(
      {
        success: true,
        originpath: r2path,
        url: `https://${c.env.R2_DOMAIN}/${r2path}`,
        processed: uploadedImages,
      },
      200
    );
  } catch (error) {
    console.error('Error processing image:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred';
    return c.json(
      { error: 'Internal server error', details: errorMessage },
      500
    );
  }
});

app.post('/:shortSize', async (c) => {
  try {
    const shortSize = c.req.param('shortSize');
    const body = await c.req.json<RequestBody>();
    const imageUrl = `https://${c.env.R2_DOMAIN}/${body.r2SourcePath}`;

    // 验证短边尺寸参数
    const validSizes = ['256', '1024', '2048'];
    if (!validSizes.includes(shortSize)) {
      return c.json(
        {
          error: `Invalid shortSize. Must be one of: ${validSizes.join(', ')}`,
        },
        400
      );
    }

    if (!imageUrl) {
      return c.json({ error: 'r2SourcePath is required' }, 400);
    }

    // 1. 获取图片
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return c.json(
        {
          error: `Failed to fetch image: ${imageResponse.statusText}`,
        },
        imageResponse.status as any
      );
    }

    const imageMimeType =
      imageResponse.headers.get('content-type') || 'image/jpeg';
    const r2path = body.r2SourcePath;
    let extension = imageMimeType.split('/')[1];
    if (extension === 'jpeg') {
      extension = 'jpg';
    }
    const originalImageObjectKey = r2path.split('.')[0] || r2path;
    const file_name = originalImageObjectKey.split('/').slice(1).join('/');

    // 2. 调整指定尺寸的图片
    let imgBuffer;
    try {
      imgBuffer = await getResize(imageUrl, shortSize);
    } catch (resizeError) {
      console.error('Error during image resizing:', resizeError);
      throw new Error(
        `Failed to resize image to ${shortSize}: ${
          resizeError instanceof Error ? resizeError.message : resizeError
        }`
      );
    }

    // 3. 上传调整大小后的图片
    let uploadedImagePath: string;
    try {
      uploadedImagePath = await uploadImageToR2(
        c.env,
        Promise.resolve(imgBuffer),
        file_name,
        'webp',
        shortSize
      );

      // 查找并更新 artifact 记录
      const artifact = await findArtifactByPath(c.env, r2path);
      if (!artifact) {
        console.error('Artifact not found for path:', r2path);
        throw new Error('Artifact not found for the given path');
      }

      // 构建更新对象，只更新指定尺寸的路径
      const pathOnly = uploadedImagePath.replace(
        `https://${c.env.R2_DOMAIN}/`,
        ''
      );
      const updates = {
        [`size_${shortSize}x_path`]: pathOnly,
        update_time: new Date().getTime(),
      };

      const updateSuccess = await updateArtifact(c.env, artifact.id, updates);
      if (!updateSuccess) {
        throw new Error('Failed to update artifact record');
      }
    } catch (uploadError) {
      console.error('Error during upload:', uploadError);
      throw new Error(
        `Failed to upload resized image: ${
          uploadError instanceof Error ? uploadError.message : uploadError
        }`
      );
    }

    return c.json(
      {
        success: true,
        originpath: r2path,
        shortSize: shortSize,
        url: `https://${c.env.R2_DOMAIN}/${r2path}`,
        processedImage: uploadedImagePath,
      },
      200
    );
  } catch (error) {
    console.error('Error processing single size image:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred';
    return c.json(
      { error: 'Internal server error', details: errorMessage },
      500
    );
  }
});

export default app;
