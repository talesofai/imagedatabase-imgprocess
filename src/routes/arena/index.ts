import { Hono } from 'hono';
import { findArtifactById } from '../../db';
import arenaUserData from '../../../public/arena_user_10.json'; // 静态导入主 JSON 文件

// 假设 Env 类型在您的项目中已定义
// interface Env {
//   R2_DOMAIN: string;
//   PGREST_URL: string;
//   PGREST_TOKEN: string;
//   // 其他绑定...
// }

const app = new Hono<{ Bindings: Env }>();

// 更新接口以包含 user_id
interface ArenaImageWithUser {
  user_id: number; // 或者 string，根据你的 JSON 文件确定
  image_id: string;
}

// 新的 API 端点，用于分页获取图片数据
app.get('/images', async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '20');
  const userIdStr = c.req.query('userId');

  if (!userIdStr) {
    return c.json(
      { error: 'User ID is required.', images: [], hasMore: false },
      400
    );
  }
  const userId = parseInt(userIdStr); // 将 userId 转换为数字进行比较
  if (isNaN(userId)) {
    return c.json(
      { error: 'Invalid User ID format.', images: [], hasMore: false },
      400
    );
  }

  if (!c.env.R2_DOMAIN) {
    console.error('R2_DOMAIN environment variable is not set.');
    return c.json(
      {
        error: 'Server configuration error: R2_DOMAIN is missing.',
        images: [],
        hasMore: false,
      },
      500
    );
  }

  // 类型断言，假设 arenaUserData 符合 ArenaImageWithUser[] 结构
  const allUserImageData = arenaUserData as ArenaImageWithUser[];

  // 根据 userId 筛选图片
  const userSpecificImages = allUserImageData.filter(
    (item) => item.user_id === userId
  );

  if (userSpecificImages.length === 0) {
    return c.json(
      {
        // 向前端提供更明确的错误信息
        error: `No images found for user ID: ${userId}`,
        images: [],
        hasMore: false,
      },
      404 // 或者返回一个空数组和 hasMore: false，取决于你希望前端如何处理
    );
  }

  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  // 对筛选后的列表进行分页
  const paginatedImageItems = userSpecificImages.slice(startIndex, endIndex);

  // 使用 Promise.all 并行处理 artifact 查询
  const artifactPromises = paginatedImageItems.map((item) =>
    findArtifactById(c.env, item.image_id).then((artifact) => ({
      item,
      artifact,
    }))
  );

  const results = await Promise.all(artifactPromises);

  const processedImages: { id: string; url: string; alt: string }[] = [];
  for (const { item, artifact } of results) {
    if (artifact && (artifact as any).original_path) {
      const imageUrl = `https://${c.env.R2_DOMAIN}/${
        (artifact as any).original_path
      }`;
      processedImages.push({
        id: item.image_id,
        url: imageUrl,
        alt: `Image ${item.image_id} for user ${userId}`,
      });
    } else {
      console.warn(
        `Artifact or original_path not found for image_id: ${item.image_id}`
      );
    }
  }

  const hasMore = endIndex < userSpecificImages.length;
  return c.json({ images: processedImages, hasMore });
});

// 修改现有的 / 端点，提供 HTML 框架和客户端 JS
app.get('/', async (c) => {
  // Server-side: Extract unique user IDs
  const allUserImageData = arenaUserData as ArenaImageWithUser[];
  const uniqueUserIds = Array.from(
    new Set(allUserImageData.map((item) => item.user_id))
  ).sort((a, b) => a - b);

  const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link
      rel="icon"
      type="image/svg+xml"
      href="https://oss.talesofai.cn/static/official/assets/asset.191b323b_Z1ocIPz.svg"
    />
    <title>用户画廊</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
            margin: 0; 
            background-color: #f0f2f5; 
            color: #1c1e21;
        }
        .header { 
            background-color: #ffffff; 
            color: #1c1e21; 
            padding: 1em 2em; 
            text-align: center; 
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border-bottom: 1px solid #dddfe2;
            position: sticky;
            top: 0;
            z-index: 1000;
        }
        .header h1 {
            margin: 0 0 0.5em 0;
            font-size: 1.8em;
        }
        .user-filter {
            margin-bottom: 1em;
            display: flex; /* Added for better alignment */
            align-items: center; /* Added for better alignment */
            justify-content: center; /* Added for better alignment */
        }
        .user-filter label { /* Added style for label */
            margin-right: 0.5em;
            font-weight: 500;
        }
        .user-filter select { /* Updated style for select */
            padding: 0.5em;
            margin-right: 0.5em;
            border: 1px solid #ddd;
            border-radius: 4px;
            min-width: 180px; /* Adjusted width */
            background-color: white;
        }
        /* .user-filter input[type="text"] removed */
        .user-filter button {
            padding: 0.5em 1em;
            background-color: #007bff;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 500;
        }
        .user-filter button:hover {
            background-color: #0056b3;
        }
        .gallery-container {
            margin: 1.5em auto;
            padding: 0 1em;
            max-width: 1600px;
            column-count: 5;
            column-gap: 1em;
        }
        .gallery-item {
            background: #ffffff;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            display: inline-block;
            margin: 0 0 1em;
            width: 100%;
            break-inside: avoid-column;
            overflow: hidden;
            transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
        }
        .gallery-item:hover {
            transform: translateY(-5px);
            box-shadow: 0 8px 16px rgba(0,0,0,0.15);
        }
        .gallery-item img {
            width: 100%;
            height: auto;
            display: block;
        }
        #loading-status {
            text-align: center;
            padding: 20px;
            font-size: 1.1em;
            color: #606770;
        }
        /* 响应式调整 */
        @media (max-width: 1600px) { .gallery-container { column-count: 4; } }
        @media (max-width: 1200px) { .gallery-container { column-count: 3; } }
        @media (max-width: 900px) { .gallery-container { column-count: 2; } }
        @media (max-width: 600px) { .gallery-container { column-count: 1; padding: 0 0.5em; } .gallery-item { margin-bottom: 0.5em; } }
    </style>
</head>
<body>
    <div class="header">
        <div class="user-filter">
            <label for="userIdSelect">选择用户ID:</label>
            <select id="userIdSelect">
                <option value="">-- 请选择用户 --</option>
                <!-- Options will be populated by JavaScript -->
            </select>
            <button id="loadUserImagesBtn">加载图片</button>
        </div>
    </div>
    <div class="gallery-container">
        <!-- 图片将由 JavaScript 动态加载到这里 -->
    </div>
    <div id="loading-status">请选择用户ID并点击加载图片。</div>

    <script>
      let currentPage = 1;
      const limit = 20;
      let isLoading = false;
      let allImagesLoaded = false;
      let currentUserId = '';
      const galleryContainer = document.querySelector('.gallery-container');
      const loadingStatus = document.getElementById('loading-status');
      // const userIdInput = document.getElementById('userIdInput'); // Removed
      const userIdSelect = document.getElementById('userIdSelect'); // Added
      const loadUserImagesBtn = document.getElementById('loadUserImagesBtn');

      const allUserIds = ${JSON.stringify(
        uniqueUserIds
      )}; // Pass uniqueUserIds from server

      // Populate the select dropdown
      if (allUserIds && allUserIds.length > 0) {
        allUserIds.forEach(id => {
          const option = document.createElement('option');
          option.value = String(id); // Ensure value is string
          option.textContent = String(id);
          userIdSelect.appendChild(option);
        });
      } else {
        // Optionally handle case where no user IDs are found, e.g., disable select/button
        userIdSelect.disabled = true;
        loadUserImagesBtn.disabled = true;
        loadingStatus.textContent = '没有可用的用户ID。';
      }
      

      async function fetchAndRenderImages() {
        if (isLoading || allImagesLoaded || !currentUserId) {
            if (!currentUserId && currentPage === 1) { // Check if currentUserId is not set
                 loadingStatus.textContent = '请选择一个用户ID并点击加载图片。'; // Updated message
                 loadingStatus.style.display = 'block';
            }
            return;
        }
        isLoading = true;
        loadingStatus.textContent = '正在加载更多图片...';
        loadingStatus.style.display = 'block';

        try {
          const response = await fetch(\`./arena/images?userId=\${currentUserId}&page=\${currentPage}&limit=\${limit}\`);
          if (!response.ok) {
            let errorMsg = \`HTTP error! status: \${response.status}\`;
            try {
                const errorData = await response.json();
                if (errorData && errorData.error) {
                    errorMsg = errorData.error;
                }
            } catch (e) {
                // 如果解析json失败，则使用原始的HTTP错误信息
            }
            throw new Error(errorMsg);
          }
          const data = await response.json();

          if (data.error) { 
            throw new Error(data.error);
          }

          if (data.images && data.images.length > 0) {
            data.images.forEach(image => {
              const itemDiv = document.createElement('div');
              itemDiv.className = 'gallery-item';
              const imgElement = document.createElement('img');
              imgElement.src = image.url;
              imgElement.alt = image.alt;
              imgElement.loading = 'lazy'; // Native lazy loading
              itemDiv.appendChild(imgElement);
              galleryContainer.appendChild(itemDiv);
            });
            currentPage++;
            // Hide loading status if images were loaded successfully
            loadingStatus.style.display = 'none';
          } else if (currentPage === 1) {
             // No images found for the user, or no more images
             loadingStatus.textContent = \`用户 \${currentUserId} 没有图片，或已加载全部。\`;
          }

          if (!data.hasMore) {
            allImagesLoaded = true;
            if (galleryContainer.children.length > 0){
                loadingStatus.textContent = '已加载全部图片。';
                loadingStatus.style.display = 'block'; // Ensure it's visible
            } else if (currentPage === 1 && (!data.images || data.images.length === 0)) {
                // Message already set above for "no images found"
                loadingStatus.style.display = 'block'; // Ensure it's visible
            }
          } else {
            // If there are more images, but current batch was empty (should not happen if hasMore is true)
            // or if images were loaded, loading status is hidden inside the block above.
            // If no images loaded in this batch but hasMore is true, keep loading status as is or hide.
            // For simplicity, if images were loaded, it's hidden. If not, it shows "no images".
          }
        } catch (error) {
          console.error("Failed to load images:", error);
          loadingStatus.textContent = error.message || '加载图片失败，请稍后重试。';
        } finally {
          isLoading = false;
        }
      }

      loadUserImagesBtn.addEventListener('click', () => {
        const newUserId = userIdSelect.value; // Get value from select
        if (!newUserId) {
          alert('请选择一个用户ID。'); // Updated message
          return;
        }
        if (newUserId === currentUserId && galleryContainer.children.length > 0) {
            // If same user and images already loaded, do nothing or provide feedback
            // For now, allow re-load.
        }

        currentUserId = newUserId;
        galleryContainer.innerHTML = ''; // Clear previous images
        currentPage = 1;
        allImagesLoaded = false;
        isLoading = false; // Reset loading flag
        loadingStatus.textContent = '正在加载图片...'; // Initial message for new user
        loadingStatus.style.display = 'block';
        fetchAndRenderImages();
      });
      
      // Optional: Also load images when the select value changes, if desired
      userIdSelect.addEventListener('change', () => {
        const newUserId = userIdSelect.value;
        if (!newUserId) {
            galleryContainer.innerHTML = '';
            loadingStatus.textContent = '请选择用户ID并点击加载图片。';
            currentUserId = '';
            allImagesLoaded = true; // Prevent scroll loading
            return;
        }
        currentUserId = newUserId;
        galleryContainer.innerHTML = '';
        currentPage = 1;
        allImagesLoaded = false;
        isLoading = false;
        loadingStatus.textContent = '正在加载图片...';
        fetchAndRenderImages();
      });

      window.addEventListener('scroll', () => {
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 200) {
          if (!isLoading && !allImagesLoaded && currentUserId) {
            fetchAndRenderImages();
          }
        }
      });
    <\/script>
</body>
</html>`; // 确保模板字符串正确结束

  return c.html(htmlContent);
});

export default app;
