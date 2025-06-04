export async function getResize(
  imgUrl: string,
  shortSize: string
): Promise<ArrayBuffer> {
  const photonServiceUrl = 'https://photon.atou.workers.dev/';
  const params = new URLSearchParams({
    url: imgUrl,
    short: shortSize,
  });
  const requestUrl = `${photonServiceUrl}?${params.toString()}`;
  try {
    const response = await fetch(requestUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch resized image: ${response.status} ${response.statusText}`
      );
    }
    return await response.arrayBuffer();
  } catch (error) {
    console.error('Error resizing image via photon service:', error);
    throw error;
  }
}
