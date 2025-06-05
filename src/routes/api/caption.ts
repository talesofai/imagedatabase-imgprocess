import { Hono } from 'hono';
import {
  createCaption,
  createArtifactCaptionMap,
  findArtifactByPath,
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
  r2SourcePath: string;
  model?: string; // Optional, defaults to 'gemini-2.5-pro-preview-05-06'
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
}

app.post('/', async (c) => {
  try {
    const body = await c.req.json<CaptionRequestBody>();
    // Assuming CaptionRequestBody does not strictly require 'token' or it's handled if present

    const imageUrl = `https://${c.env.R2_DOMAIN}/${body.r2SourcePath}`;

    if (!body.r2SourcePath) {
      return c.json({ error: 'r2SourcePath is required' }, 400);
    }

    const geminiModel = body.model || 'gemini-2.5-pro-preview-05-06';
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
    const imageMimeType =
      imageResponse.headers.get('content-type') || 'image/jpeg';

    // 2. Convert image to base64 for Gemini
    const imageBase64 = arrayBufferToBase64(imageArrayBuffer);

    // 3. Get Gemini API Key from environment variables
    const apiKey = c.env.GEMINI_API_KEY;
    if (!apiKey) {
      return c.json({ error: 'Gemini API key is not configured.' }, 500);
    }

    // 4. Prepare request for Gemini API
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
          generationConfig: {
            temperature: temperature,
          },
        },
      ],
    };
    // 5. Call Gemini API
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
        geminiApiResponse.status as any // Cast status for Hono
      );
    }

    const geminiResult = (await geminiApiResponse.json()) as GeminiResponse; // 6. Extract text from Gemini response
    const captionText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!captionText) {
      console.error(
        'Could not extract caption from Gemini response:',
        geminiResult
      );
      return c.json(
        {
          error: 'Failed to parse caption from Gemini response',
          details: geminiResult,
        },
        500
      );
    }

    // 7. Save caption to database
    try {
      // Find the artifact by original_path
      const artifact = await findArtifactByPath(c.env, body.r2SourcePath);

      if (!artifact) {
        console.warn(`Artifact not found for path: ${body.r2SourcePath}`);
        // Still return the caption even if we can't save to database
        return c.json(
          {
            success: true,
            caption: captionText,
            model_id: geminiModel,
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
        model: geminiModel,
        prompt: geminiPrompt,
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
            model_id: geminiModel,
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
            model_id: geminiModel,
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
          model_id: geminiModel,
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
          model_id: geminiModel,
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

export default app;
