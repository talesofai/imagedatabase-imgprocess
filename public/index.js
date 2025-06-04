const API_BASE_URL = '/api/v1'; // 根据你的部署调整

function getMimeType(fileName) {
  const extension = fileName
    .slice(((fileName.lastIndexOf('.') - 1) >>> 0) + 2)
    .toLowerCase();
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream'; // Fallback
  }
}

function getAuthToken() {
  const token = document.getElementById('authToken').value;
  if (!token) {
    alert('请输入 Auth Token!');
    return null;
  }
  return token;
}

async function executeInPool(items, asyncFn, poolLimit) {
  const results = []; // Not strictly needed here as we use allSettledPromises for final results
  const executing = []; // Stores promises currently being executed
  const allSettledPromises = []; // Stores all promises created, for Promise.allSettled

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Create the promise for the current item's task.
    // This immediately calls asyncFn.
    const promise = (async () => {
      return await asyncFn(item, i, items);
    })();

    allSettledPromises.push(promise); // Add to the list of all promises

    // Create a wrapper promise that will be added to the executing pool.
    // This wrapper resolves/rejects when the original promise does,
    // and its 'finally' block removes itself from the executing pool.
    const taskWrapper = promise.finally(() => {
      // Remove this taskWrapper from the executing array once it's done
      const indexInExecuting = executing.indexOf(taskWrapper);
      if (indexInExecuting !== -1) {
        executing.splice(indexInExecuting, 1);
      }
    });
    executing.push(taskWrapper);

    // If the pool is full, wait for one of the executing tasks to complete
    // before starting a new one.
    if (executing.length >= poolLimit) {
      await Promise.race(executing);
    }
  }

  // Wait for all initiated promises to settle
  return Promise.allSettled(allSettledPromises);
}

// Handle ZIP file upload and processing

async function handleZipUpload() {
  const fileInput = document.getElementById('zipFile');
  const statusArea = document.getElementById('statusArea');

  const overallProgressContainer = document.getElementById(
    'overallProgressContainer'
  );
  const overallProgressBar = document.getElementById('overallProgressBar');
  const overallProgressText = document.getElementById('overallProgressText');
  const fileProgressContainer = document.getElementById(
    'fileProgressContainer'
  );

  // Define how many uploads can run at the same time
  const CONCURRENT_UPLOAD_LIMIT = 20; // You can adjust this value

  if (!fileInput.files.length) {
    statusArea.textContent = '请先选择一个 ZIP 文件。'; // Please select a ZIP file first.
    return;
  }

  const file = fileInput.files[0];
  statusArea.textContent = '正在读取 ZIP 文件...'; // Reading ZIP file...
  overallProgressContainer.classList.remove('hidden');
  fileProgressContainer.classList.remove('hidden');
  fileProgressContainer.innerHTML = ''; // Clear previous logs
  overallProgressBar.value = 0;
  overallProgressText.textContent = '';

  let filesProcessedCount = 0; // Counter for overall progress

  try {
    const jszip = new JSZip(); // Assuming JSZip is available globally or imported
    const zip = await jszip.loadAsync(file);

    statusArea.innerHTML = `ZIP 文件读取成功。发现 ${
      Object.keys(zip.files).length
    } 个文件。开始处理...<br>`; // ZIP file read successfully. Found X files. Starting processing...

    const imageFiles = [];
    zip.forEach((relativePath, zipEntry) => {
      if (
        !zipEntry.dir &&
        !relativePath.startsWith('__MACOSX/') &&
        /\.(jpg|jpeg|png|gif|webp)$/i.test(zipEntry.name)
      ) {
        imageFiles.push({
          name: zipEntry.name,
          entry: zipEntry,
          id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        });
      }
    });

    if (imageFiles.length === 0) {
      statusArea.innerHTML +=
        'ZIP 包中未找到符合条件的图片文件 (jpg, png, gif, webp)。'; // No eligible image files found in ZIP.
      overallProgressContainer.classList.add('hidden');
      fileProgressContainer.classList.add('hidden');
      return;
    }
    statusArea.innerHTML += `在ZIP中找到 ${imageFiles.length} 个图片文件。准备上传...<br>`; // Found X image files in ZIP. Preparing to upload...
    overallProgressBar.max = imageFiles.length;
    overallProgressText.textContent = `0/${imageFiles.length}`;

    imageFiles.forEach((imageFile) => {
      const fileDiv = document.createElement('div');
      fileDiv.id = imageFile.id;
      fileDiv.classList.add('file-entry');
      fileDiv.textContent = `${imageFile.name} - 排队中...`; // Queued...
      fileProgressContainer.appendChild(fileDiv);
    });

    // The core upload logic for a single file, to be used with executeInPool
    const uploadFileTask = async (imageFile) => {
      const fileDiv = document.getElementById(imageFile.id);
      fileDiv.classList.remove('file-success', 'file-error');
      fileDiv.classList.add('file-processing');
      fileDiv.textContent = `${imageFile.name} - 准备上传...`; // Preparing to upload...

      // Fetch token just before upload, in case it expires
      const token = getAuthToken();
      if (!token) {
        fileDiv.classList.remove('file-processing');
        fileDiv.classList.add('file-error');
        fileDiv.textContent = `❌ ${imageFile.name} - 认证失败`; // Authentication failed
        return {
          status: 'error',
          type: 'auth',
          message: 'Authentication token not available',
          fileName: imageFile.name,
        };
      }

      try {
        const rawBlob = await imageFile.entry.async('blob');
        const mimeType = getMimeType(imageFile.name); // Assuming getMimeType is defined
        const typedBlob = new Blob([rawBlob], { type: mimeType });

        fileDiv.textContent = `${imageFile.name} - 正在上传 (${mimeType})...`; // Uploading...

        const formData = new FormData();
        formData.append('imageFile', typedBlob, imageFile.name);
        formData.append('fileName', imageFile.name);

        // API_BASE_URL is assumed to be defined
        const uploadResponse = await fetch(`${API_BASE_URL}/upload`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        if (uploadResponse.ok) {
          const responseData = await uploadResponse.json();
          if (responseData.success) {
            fileDiv.classList.remove('file-processing');
            fileDiv.classList.add('file-success');
            fileDiv.textContent = `✅ ${imageFile.name} 上传成功! R2 Path: ${responseData.r2Path}`; // Upload successful!
            return {
              status: 'success',
              r2Path: responseData.r2Path,
              fileName: imageFile.name,
            };
          } else {
            fileDiv.classList.remove('file-processing');
            fileDiv.classList.add('file-error');
            fileDiv.textContent = `❌ ${imageFile.name} 上传失败 (${
              uploadResponse.status
            }): ${responseData.error || 'API reported an error'}`; // Upload failed
            return {
              status: 'error',
              type: 'api',
              message: responseData.error || 'API reported an error',
              fileName: imageFile.name,
            };
          }
        } else {
          fileDiv.classList.remove('file-processing');
          fileDiv.classList.add('file-error');
          let errorDetail = `服务器错误 (${uploadResponse.status})`; // Server error
          try {
            const errorData = await uploadResponse.json();
            errorDetail =
              errorData.error || errorData.message || JSON.stringify(errorData);
          } catch (jsonParseError) {
            try {
              errorDetail = await uploadResponse.text();
            } catch (textParseError) {
              errorDetail = uploadResponse.statusText;
            }
          }
          fileDiv.textContent = `❌ ${imageFile.name} 上传失败: ${errorDetail}`; // Upload failed
          return {
            status: 'error',
            type: 'http',
            message: errorDetail,
            fileName: imageFile.name,
          };
        }
      } catch (e) {
        fileDiv.classList.remove('file-processing');
        fileDiv.classList.add('file-error');
        fileDiv.textContent = `❌ ${imageFile.name} 处理出错: ${e.message}`; // Processing error
        return {
          status: 'error',
          type: 'network_or_internal',
          message: e.message,
          fileName: imageFile.name,
        };
      } finally {
        filesProcessedCount++;
        overallProgressBar.value = filesProcessedCount;
        overallProgressText.textContent = `${filesProcessedCount}/${imageFiles.length}`;
      }
    };

    // Use the pool to process uploads
    const results = await executeInPool(
      imageFiles,
      uploadFileTask,
      CONCURRENT_UPLOAD_LIMIT
    );

    let successfulUploads = 0;
    let failedUploads = 0;
    let firstSuccessR2PathSet = false;

    results.forEach((result, index) => {
      const imageFile = imageFiles[index]; // Get original imageFile for context if needed
      // const fileDiv = document.getElementById(imageFile.id); // Div is already updated by uploadFileTask

      if (result.status === 'fulfilled') {
        const outcome = result.value; // This is the object returned by uploadFileTask
        if (outcome) {
          if (outcome.status === 'success') {
            successfulUploads++;
            if (!firstSuccessR2PathSet && outcome.r2Path) {
              // Ensure these elements exist if you're setting their value
              const processR2PathEl = document.getElementById('processR2Path');
              const captionR2PathEl = document.getElementById('captionR2Path');
              if (processR2PathEl) processR2PathEl.value = outcome.r2Path;
              if (captionR2PathEl) captionR2PathEl.value = outcome.r2Path;
              firstSuccessR2PathSet = true;
            }
          } else {
            // outcome.status === 'error'
            failedUploads++;
          }
        } else {
          // This case should ideally not happen if uploadFileTask always returns an object
          failedUploads++;
          const fileDiv = document.getElementById(imageFile.id);
          if (fileDiv) {
            fileDiv.classList.remove('file-processing', 'file-success');
            fileDiv.classList.add('file-error');
            fileDiv.textContent = `❌ ${imageFile.name} - 未知的上传结果`; // Unknown upload result
          }
          console.error(`Unexpected outcome for ${imageFile.name}:`, outcome);
        }
      } else {
        // result.status === 'rejected'
        // This would happen if executeInPool itself had an issue, or if uploadFileTask
        // threw an error that wasn't caught by its internal try/catch (unlikely with current setup).
        failedUploads++;
        const fileDiv = document.getElementById(imageFile.id); // Get the div associated with imageFiles[index]
        if (fileDiv) {
          fileDiv.classList.remove('file-processing', 'file-success');
          fileDiv.classList.add('file-error');
          fileDiv.textContent = `❌ ${imageFile.name} - 未预料的上传错误: ${
            result.reason.message || result.reason
          }`; // Unexpected upload error
        }
        console.error(
          `Unhandled rejection for ${imageFile.name}:`,
          result.reason
        );
      }
    });

    statusArea.innerHTML += `--- 上传完成 ---<br>成功: ${successfulUploads}, 失败: ${failedUploads}<br>`; // --- Upload complete --- Success: X, Failed: Y
    if (failedUploads > 0) {
      statusArea.innerHTML += `<span class='file-error'>部分文件上传失败，请检查上方列表。</span><br>`; // Some files failed to upload, please check the list above.
    }
  } catch (error) {
    statusArea.textContent = `处理ZIP文件失败: ${error.message}`; // Failed to process ZIP file
    console.error('ZIP处理错误:', error);
    overallProgressContainer.classList.add('hidden');
    fileProgressContainer.classList.add('hidden');
  }
}

async function handleImageProcess() {
  const r2PathInput = document.getElementById('processR2Path');
  const statusArea = document.getElementById('processStatus');
  const token = getAuthToken();
  if (!token) return;

  const r2SourcePath = r2PathInput.value;
  if (!r2SourcePath) {
    statusArea.textContent = '请输入 R2 Source Path。';
    return;
  }

  statusArea.textContent = '正在请求处理图像...';
  try {
    const response = await fetch(`${API_BASE_URL}/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ r2SourcePath }),
    });

    const data = await response.json();
    if (response.ok && data.success) {
      statusArea.innerHTML = `图像处理成功！<br>
                                         原始路径 (R2 Key): ${data.originpath}<br>
                                         原始图像URL: <a href="${data.url}" target="_blank">${data.url}</a><br>
                                         调整大小的图像已保存到R2。`;
    } else {
      statusArea.textContent = `处理失败: ${data.error || response.statusText}`;
    }
  } catch (error) {
    statusArea.textContent = `请求错误: ${error.message}`;
  }
}

async function handleImageCaption() {
  const r2PathInput = document.getElementById('captionR2Path');
  const modelInput = document.getElementById('captionModel');
  const promptInput = document.getElementById('captionPrompt');
  const statusArea = document.getElementById('captionStatus');
  const token = getAuthToken();
  if (!token) return;

  const r2SourcePath = r2PathInput.value;
  if (!r2SourcePath) {
    statusArea.textContent = '请输入 R2 Source Path。';
    return;
  }

  const payload = { r2SourcePath };
  if (modelInput.value) payload.model = modelInput.value;
  if (promptInput.value) payload.prompt = promptInput.value;

  statusArea.textContent = '正在请求生成标签...';
  try {
    const response = await fetch(`${API_BASE_URL}/caption`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (response.ok && data.success) {
      statusArea.innerHTML = `标签生成成功！<br>
                                         标签: ${data.caption.join(', ')}`;
    } else {
      statusArea.textContent = `生成标签失败: ${
        data.error || response.statusText
      }`;
    }
  } catch (error) {
    statusArea.textContent = `请求错误: ${error.message}`;
  }
}
