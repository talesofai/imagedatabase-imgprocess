import { Hono } from 'hono';
import {
  createCaption,
  createArtifactCaptionMap,
  findArtifactByPath,
  findArtifactById,
  findArtifactCaptionMap,
  findCaptionById,
} from '../../db/index';

const app = new Hono<{ Bindings: Env }>();

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

interface CaptionRequestBody {
  r2SourcePath?: string;
  image_id?: string;
  size?: string; // Optional, defaults to '1024'
  model?: string; // Optional, defaults to 'gemini-2.5-pro-preview-05-06'
  provider?: 'gemini' | 'openai'; // Optional, defaults to 'gemini'
  prompt?: string; // Optional, defaults to 'Generate a concise, descriptive caption for this image.'
  presetkey?: string; // Optional, defaults to 'gemini_english_description'
  tempreture?: number; // Optional, defaults to 0.7
}

interface GeminiCandidate {
  content: {
    parts: Array<{ text: string }>;
  };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    totalTokenCount?: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

interface OpenAIResponse {
  choices?: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    total_tokens?: number;
  };
}

app.get('/', async (c) => {
  const image_id = c.req.query('image_id');
  const r2SourcePath = c.req.query('r2SourcePath');
  if (!image_id && !r2SourcePath) {
    return c.json({ error: 'image_id or r2SourcePath is required' }, 400);
  }
  if (image_id && r2SourcePath) {
    return c.json(
      { error: 'Only one of image_id or r2SourcePath should be provided' },
      400
    );
  }
  let artifact;
  if (image_id) {
    artifact = await findArtifactById(c.env, image_id);
    if (!artifact) {
      return c.json({ error: 'Artifact not found' }, 404);
    }
  }
  if (r2SourcePath) {
    artifact = await findArtifactByPath(c.env, r2SourcePath);
    if (!artifact) {
      return c.json({ error: 'Artifact not found' }, 404);
    }
  }
  if (!artifact) {
    return c.json({ error: 'Artifact not found' }, 404);
  }
  const artifact_caption_maps = await findArtifactCaptionMap(
    c.env,
    artifact.id
  );
  if (!artifact_caption_maps) {
    return c.json({ error: 'No captions found for this artifact' }, 404);
  }
  const captions = await Promise.all(
    artifact_caption_maps.map(async (map) => {
      const caption = await findCaptionById(c.env, map.caption_id);
      if (!caption) {
        return null; // Skip if caption not found
      } // Try to parse value_text as JSON if it looks like JSON or Markdown JSON block
      let parsedValueText = caption.value_text;
      if (caption.value_text) {
        const trimmedText = caption.value_text.trim();
        let jsonText: string | null = trimmedText;

        // Check if it's a Markdown JSON block
        if (trimmedText.startsWith('```json') && trimmedText.endsWith('```')) {
          // Extract JSON from Markdown block
          jsonText = trimmedText.slice(7, -3).trim(); // Remove ```json and ```
        } else if (trimmedText.startsWith('{')) {
          // Direct JSON
          jsonText = trimmedText;
        } else {
          // Not JSON, keep original
          jsonText = null;
        }

        if (jsonText) {
          try {
            parsedValueText = JSON.parse(jsonText);
          } catch (error) {
            // If parsing fails, keep the original text
            console.warn(
              `Failed to parse JSON for caption ${caption.id}:`,
              error
            );
            parsedValueText = caption.value_text;
          }
        }
      }

      return {
        ...caption,
        value_text: parsedValueText,
      };
    })
  );
  return c.json(
    {
      success: true,
      artifact: {
        id: artifact.id,
        original_path: artifact.original_path,
        image_url: `https://${c.env.R2_DOMAIN}/${artifact.original_path}`,
        created_at: artifact.created_time,
        updated_at: artifact.update_time,
      },
      captions: captions.filter((c) => c !== null),
    },
    200
  );
});

app.post('/', async (c) => {
  try {
    const body = await c.req.json<CaptionRequestBody>();
    let artifactToSave: Awaited<ReturnType<typeof findArtifactById>> | null =
      null; // Variable to store artifact if fetched by ID
    // Assuming CaptionRequestBody does not strictly require 'token' or it's handled if present
    if (!body.r2SourcePath && !body.image_id) {
      return c.json(
        { error: 'Either r2SourcePath or image_id is required' },
        400
      );
    }
    if (body.image_id && body.r2SourcePath) {
      return c.json(
        { error: 'Only one of r2SourcePath or image_id should be provided' },
        400
      );
    }
    // If r2SourcePath is provided, use it directly
    if (body.image_id) {
      const artifact = await findArtifactById(c.env, body.image_id);
      if (!artifact) {
        return c.json({ error: 'Artifact not found' }, 404);
      }
      artifactToSave = artifact;
      if (body.size && ['1024x', '256x', '2048x'].includes(body.size)) {
        body.r2SourcePath =
          artifact[
            `size_${body.size}_path` as
              | 'size_1024x_path'
              | 'size_256x_path'
              | 'size_2048x_path'
          ] || artifact.original_path;
      } else {
        body.r2SourcePath = artifact.original_path;
      }
    }
    const imageUrl = `https://${c.env.R2_DOMAIN}/${body.r2SourcePath}`;

    if (!body.r2SourcePath) {
      return c.json({ error: 'r2SourcePath is required' }, 400);
    }

    const provider = body.provider || 'gemini';
    const geminiModel = body.model || 'gemini-2.5-pro-preview-05-06';
    const openaiModel = body.model || 'gpt-4o';
    const geminiPrompt =
      body.prompt ||
      'Generate a list of relevant tags for this image. Provide them as a comma-separated list.'; // Changed default prompt
    const presetkey = body.presetkey || 'gemini_english_description';
    const temperature = body.tempreture || 0.7;

    // 1. Fetch the image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return c.json(
        { error: `Failed to fetch image: ${imageResponse.statusText}` },
        imageResponse.status as any // Cast status to any for Hono compatibility
      );
    }
    const imageArrayBuffer = await imageResponse.arrayBuffer();
    let imageMimeType =
      imageResponse.headers.get('content-type') || 'image/jpeg';
    // 出现其他Mimetype 会报错 比如application/octet-stream
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];

    if (imageMimeType && !allowedMimeTypes.includes(imageMimeType)) {
      imageMimeType = 'image/jpeg';
    }

    // 2. Convert image to base64 for Gemini
    const imageBase64 = arrayBufferToBase64(imageArrayBuffer);

    // 3. Get API Key from environment variables
    let apiKey: string;
    if (provider === 'openai') {
      apiKey = c.env.OPENAI_API_KEY;
      if (!apiKey) {
        return c.json({ error: 'OpenAI API key is not configured.' }, 500);
      }
    } else {
      apiKey = c.env.GEMINI_API_KEY;
      if (!apiKey) {
        return c.json({ error: 'Gemini API key is not configured.' }, 500);
      }
    }

    let captionText: string | undefined;
    let totalTokenCount: number | undefined;

    if (provider === 'openai') {
      // 4. Call OpenAI API
      const openaiBaseUrl = c.env.OPENAI_BASE_URL || 'https://api.openai.com';
      const openaiApiUrl = `${openaiBaseUrl}/v1/chat/completions`;

      const openaiPayload = {
        model: openaiModel,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: geminiPrompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${imageMimeType};base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        temperature: temperature,
        max_tokens: 1000,
      };

      const openaiApiResponse = await fetch(openaiApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(openaiPayload),
      });

      if (!openaiApiResponse.ok) {
        const errorBody = await openaiApiResponse.text();
        console.error('OpenAI API error:', errorBody);
        return c.json(
          {
            error: `OpenAI API request failed: ${openaiApiResponse.statusText}`,
            details: errorBody,
          },
          openaiApiResponse.status as any
        );
      }

      const openaiResult = (await openaiApiResponse.json()) as OpenAIResponse;
      captionText = openaiResult.choices?.[0]?.message?.content;
      if (openaiResult.usage) {
        totalTokenCount = openaiResult.usage.total_tokens;
      }
    } else {
      // 4. Call Gemini API
      const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;

      const geminiPayload = {
        contents: [
          {
            parts: [
              { text: geminiPrompt },
              {
                inline_data: {
                  mime_type: imageMimeType,
                  data: imageBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: temperature,
        },
      };

      const geminiApiResponse = await fetch(geminiApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(geminiPayload),
      });

      if (!geminiApiResponse.ok) {
        const errorBody = await geminiApiResponse.text();
        console.error('Gemini API error:', errorBody);
        return c.json(
          {
            error: `Gemini API request failed: ${geminiApiResponse.statusText}`,
            details: errorBody,
          },
          geminiApiResponse.status as any
        );
      }

      const geminiResult = (await geminiApiResponse.json()) as GeminiResponse;
      captionText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;
      if (geminiResult.usageMetadata) {
        totalTokenCount = geminiResult.usageMetadata.totalTokenCount;
      }
    }

    if (!captionText) {
      console.error(`Could not extract caption from ${provider} response`);
      return c.json(
        {
          error: `Failed to parse caption from ${provider} response`,
        },
        500
      );
    }

    // 7. Save caption to database
    try {
      // Find the artifact by original_path
      let artifact = artifactToSave; // Use the stored artifact if available
      if (!artifact) {
        // If not fetched by ID, fetch by path
        artifact = await findArtifactByPath(c.env, body.r2SourcePath!);
      }

      if (!artifact) {
        console.warn(`Artifact not found for path: ${body.r2SourcePath}`);
        // Still return the caption even if we can't save to database
        return c.json(
          {
            success: true,
            caption: captionText,
            model_id: provider === 'openai' ? openaiModel : geminiModel,
            provider: provider,
            imagepath: body.r2SourcePath,
            warning:
              'Caption generated but not saved to database - artifact not found',
          },
          200
        );
      }

      // 创建caption
      const currentTime = Date.now();
      const captionId = crypto.randomUUID();
      const extra_data = {
        model: provider === 'openai' ? openaiModel : geminiModel,
        provider: provider,
        prompt: geminiPrompt,
        total_token_count: totalTokenCount || 0,
        temperature: temperature,
        image_path: body.r2SourcePath,
      };
      const captionRecord = {
        id: captionId,
        type: 'ai-generated',
        preset_key: presetkey,
        upload_time: currentTime,
        value_text: captionText,
        extra_data: extra_data as any,
        is_deleted: false,
      };
      const savedCaption = await createCaption(c.env, captionRecord);

      if (!savedCaption) {
        console.error('Failed to save caption to database');
        // Still return the caption even if database save failed
        return c.json(
          {
            success: true,
            caption: captionText,
            model_id: provider === 'openai' ? openaiModel : geminiModel,
            provider: provider,
            imagepath: body.r2SourcePath,
            warning: 'Caption generated but failed to save to database',
          },
          200
        );
      }

      // Create artifact-caption mapping
      const mappingRecord = {
        artifact_id: artifact.id,
        caption_id: captionId,
        add_time: currentTime,
      };

      const savedMapping = await createArtifactCaptionMap(c.env, mappingRecord);

      if (!savedMapping) {
        console.error('Failed to save artifact-caption mapping');
        // Caption was saved but mapping failed
        return c.json(
          {
            success: true,
            caption: captionText,
            model_id: provider === 'openai' ? openaiModel : geminiModel,
            provider: provider,
            imagepath: body.r2SourcePath,
            caption_id: captionId,
            warning: 'Caption saved but failed to create artifact mapping',
          },
          200
        );
      }

      // All database operations successful
      return c.json(
        {
          success: true,
          caption: captionText,
          model_id: provider === 'openai' ? openaiModel : geminiModel,
          total_token_count: totalTokenCount || 0,
          provider: provider,
          imagepath: body.r2SourcePath,
          caption_id: captionId,
          artifact_id: artifact.id,
          saved_to_database: true,
        },
        200
      );
    } catch (dbError) {
      console.error('Database error during caption save:', dbError);
      // Still return the caption even if database operations failed
      return c.json(
        {
          success: true,
          caption: captionText,
          model_id: provider === 'openai' ? openaiModel : geminiModel,
          provider: provider,
          imagepath: body.r2SourcePath,
          warning: 'Caption generated but database save failed',
          error_details:
            dbError instanceof Error
              ? dbError.message
              : 'Unknown database error',
        },
        200
      );
    }
  } catch (error) {
    console.error('Error generating caption:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred';
    return c.json(
      { error: 'Internal server error', details: errorMessage },
      500
    );
  }
});

interface CreateRequestBody {
  prompt: string;
  model: string;
  temperature?: number; // Optional, defaults to 0.7
}

app.post('/create', async (c) => {
  try {
    const body = await c.req.json<CreateRequestBody>();
    if (!body.prompt || !body.model) {
      return c.json({ error: 'prompt and model are required' }, 400);
    }

    const temperature = body.temperature || 0.7;

    // Get Gemini API Key from environment variables
    const apiKey = c.env.GEMINI_API_KEY;
    if (!apiKey) {
      return c.json({ error: 'Gemini API key is not configured.' }, 500);
    }

    // Call Gemini API
    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${body.model}:generateContent?key=${apiKey}`;

    const geminiPayload = {
      contents: [
        {
          parts: [{ text: body.prompt }],
        },
      ],
      generationConfig: {
        temperature: temperature,
      },
    };

    const geminiApiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geminiPayload),
    });

    if (!geminiApiResponse.ok) {
      const errorBody = await geminiApiResponse.text();
      console.error('Gemini API error:', errorBody);
      return c.json(
        {
          error: `Gemini API request failed: ${geminiApiResponse.statusText}`,
          details: errorBody,
        },
        geminiApiResponse.status as any
      );
    }

    const geminiResult = (await geminiApiResponse.json()) as GeminiResponse;
    const responseText =
      geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText) {
      console.error('Could not extract response from Gemini API');
      return c.json(
        {
          error: 'Failed to parse response from Gemini API',
        },
        500
      );
    }

    return c.json(
      {
        success: true,
        response: responseText,
        model: body.model,
        prompt: body.prompt,
        temperature: temperature,
      },
      200
    );
  } catch (error) {
    console.error('Error in create endpoint:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred';
    return c.json(
      { error: 'Internal server error', details: errorMessage },
      500
    );
  }
});

export default app;
