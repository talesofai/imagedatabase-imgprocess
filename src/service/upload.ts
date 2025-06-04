export async function uploadImageToR2(
  env: Env,
  image: Promise<ArrayBuffer>,
  filename: string,
  imageMimeType: string = 'webp',
  shortSize: string
): Promise<string> {
  const r2Bucket = env.IMAGE_BUCKET;

  try {
    // 等待图片数据
    const imageData = await image;
    const short = shortSize + 'x';
    const fileName = `${short}/${filename}.${imageMimeType}`;

    // 上传到 R2
    await r2Bucket.put(fileName, imageData, {
      httpMetadata: {
        contentType: `image/${imageMimeType}`,
      },
    });

    // 返回文件的 URL
    return `https://${env.R2_DOMAIN}/${fileName}`;
  } catch (error) {
    console.error(
      `Error during R2 upload for size ${shortSize} (potentially after resize):`,
      error
    );
    if (error instanceof Error) {
      // 抛出更具体的错误信息，包括原始错误消息和尺寸
      throw new Error(
        `R2 upload failed for size ${shortSize}: ${error.message}`
      );
    }
    // 如果捕获的不是 Error 实例，则抛出通用但带有尺寸信息的错误
    throw new Error(
      `R2 upload failed for size ${shortSize} due to an unknown error.`
    );
  }
}
