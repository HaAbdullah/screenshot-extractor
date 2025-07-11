const axios = require("axios");

exports.handler = async function (event, context) {
  // Declare startTime at function scope so it's available everywhere
  const startTime = Date.now();

  // Ensure the request is a POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    // Parse the request body
    const body = JSON.parse(event.body);
    const imageBase64 = body.imageBase64;
    const filename = body.filename || "unknown";
    const selectedModel = body.selectedModel || "claude-3-5-sonnet-20241022";

    if (!imageBase64) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No image data provided" }),
      };
    }

    console.log(`Processing file: ${filename} with model: ${selectedModel}`);

    let response;

    // Determine which API to use based on the selected model
    if (selectedModel.startsWith("claude")) {
      // Claude/Anthropic API call
      const claudeEndpoint = "https://api.anthropic.com/v1/messages";

      // Enhanced prompt for Claude's superior vision capabilities
      const analysisPrompt = `You are an expert at extracting information from screenshots and images. Analyze this image carefully and extract ALL visible text information for EVERY person shown.

Look meticulously for:
- Full names (first and last names)
- Company/organization names and logos
- Job titles, roles, and positions
- Professional credentials, certifications, degrees, licenses
- Conference badges, name tags, business cards
- LinkedIn profiles, email signatures, presentations

Format each person exactly as:
Name: [full name or - if not clearly visible]
Company: [company/organization name or - if not visible]
Role: [job title/position or - if not visible]
Credentials: [degrees/certifications/licenses or - if not visible]

If multiple people are visible, separate each person with a blank line. Extract ALL text you can see, even if partially obscured. Be thorough and precise.`;

      // Convert base64 to the format Claude expects
      let imageData, mimeType;
      try {
        if (imageBase64.startsWith("data:")) {
          const matches = imageBase64.match(/data:([^;]+);base64,(.+)/);
          if (matches) {
            mimeType = matches[1];
            imageData = matches[2];
          } else {
            throw new Error("Invalid base64 format");
          }
        } else {
          // Assume it's already base64 encoded
          imageData = imageBase64;
          mimeType = "image/jpeg"; // Default
        }

        console.log(`Using Claude API with model: ${selectedModel}`);
        console.log(
          `Image data length: ${imageData.length}, MIME type: ${mimeType}`
        );

        response = await axios.post(
          claudeEndpoint,
          {
            model: "claude-3-5-sonnet-20241022", // Use exact model name
            max_tokens: 1500,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: analysisPrompt,
                  },
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: mimeType,
                      data: imageData,
                    },
                  },
                ],
              },
            ],
          },
          {
            headers: {
              "Content-Type": "application/json",
              "x-api-key": process.env.ANTHROPIC_API_KEY,
              "anthropic-version": "2023-06-01",
            },
            timeout: 30000,
          }
        );

        const processingTime = Date.now() - startTime;
        console.log(`Claude API call completed in ${processingTime}ms`);
        console.log(`Response status: ${response.status}`);

        return {
          statusCode: 200,
          body: JSON.stringify({
            text: response.data.content[0].text,
            filename: filename,
            model: selectedModel,
            processingTime: processingTime,
          }),
        };
      } catch (claudeError) {
        console.error("Claude API specific error:", claudeError.message);
        if (claudeError.response) {
          console.error("Claude error response:", claudeError.response.data);
          console.error("Claude error status:", claudeError.response.status);
        }
        throw claudeError; // Re-throw to be handled by main error handler
      }
    } else if (
      selectedModel.startsWith("gpt-4") ||
      selectedModel === "gpt-4o-mini"
    ) {
      // OpenAI API call - support new GPT-4.1 models
      let modelToUse = selectedModel;

      // Map to actual model names if needed
      if (selectedModel === "gpt-4.1-nano") {
        modelToUse = "gpt-4.1-nano"; // Use the actual model name
      } else if (selectedModel === "gpt-4o") {
        modelToUse = "gpt-4o-mini"; // Fallback to mini for better rate limits
      }

      // Enhanced prompt for better extraction
      const analysisPrompt = `Analyze this image and extract ALL visible text information for EVERY person shown. Look carefully for:
- Full names (first and last names)
- Company/organization names  
- Job titles/roles
- Professional credentials, certifications, degrees

Format each person exactly as:
Name: [full name or - if not visible]
Company: [company name or - if not visible]  
Role: [job title or - if not visible]
Credentials: [degrees/certifications or - if not visible]

If multiple people are visible, separate each person with a blank line. Be thorough and extract all text you can see.`;

      response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: modelToUse,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: analysisPrompt,
                },
                {
                  type: "image_url",
                  image_url: { url: imageBase64 },
                },
              ],
            },
          ],
          max_tokens: 1500, // Increased for better coverage
          temperature: 0.1, // Lower for more consistent extraction
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          timeout: 30000,
        }
      );

      const processingTime = Date.now() - startTime;
      console.log(`OpenAI API call completed in ${processingTime}ms`);

      return {
        statusCode: 200,
        body: JSON.stringify({
          text: response.data.choices[0].message.content,
          filename: filename,
          model: modelToUse,
          processingTime: processingTime,
        }),
      };
    } else {
      // OpenRouter API call for other models
      const openRouterEndpoint =
        "https://openrouter.ai/api/v1/chat/completions";

      const analysisPrompt = `Extract the full name, company name, job role, and professional credentials for ALL people visible in this image. If there are multiple people, list each person separately with a blank line between them.

Format exactly as:
Name: [full name or - if not visible]
Company: [company name or - if not visible]
Role: [job title or - if not visible]  
Credentials: [degrees/certifications or - if not visible]

Name: [next person...]
Company: [...]
Role: [...]
Credentials: [...]

Look carefully at all text in the image including badges, name tags, titles, and any visible credentials.`;

      response = await axios.post(
        openRouterEndpoint,
        {
          model: selectedModel,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: analysisPrompt,
                },
                {
                  type: "image_url",
                  image_url: { url: imageBase64 },
                },
              ],
            },
          ],
          max_tokens: 1500,
          temperature: 0.1,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "HTTP-Referer":
              process.env.APP_URL || "https://screenshot-analyzer.netlify.app",
            "X-Title": "Screenshot Analyzer",
          },
          timeout: 30000,
        }
      );

      const processingTime = Date.now() - startTime;
      console.log(`OpenRouter API call completed in ${processingTime}ms`);

      return {
        statusCode: 200,
        body: JSON.stringify({
          text: response.data.choices[0].message.content,
          filename: filename,
          model: selectedModel,
          processingTime: processingTime,
        }),
      };
    }
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(
      `Error processing image after ${processingTime}ms: ${error.message}`
    );

    // Handle timeout errors specifically
    if (error.code === "ECONNABORTED") {
      return {
        statusCode: 504,
        body: JSON.stringify({
          error: "Analysis timed out. Please try with a smaller image.",
          type: "timeout_error",
          isTimeout: true,
        }),
      };
    }

    // Enhanced API error handling
    if (error.response && error.response.data) {
      const statusCode = error.response.status;
      const errorData = error.response.data;
      const errorMessage =
        errorData.error?.message || error.response.statusText;

      console.error(`API error (${statusCode}): ${errorMessage}`);
      console.error("Full error response:", JSON.stringify(errorData, null, 2));

      // Handle API errors with enhanced Claude-specific context
      if (statusCode === 502) {
        return {
          statusCode: 502,
          body: JSON.stringify({
            error: "Bad Gateway - API server error",
            type: "server_error",
            suggestion: selectedModel.startsWith("claude")
              ? "Claude API server issue. Check your API key format and try again, or switch to OpenAI temporarily."
              : "OpenAI API server issue. Try again in a few moments.",
            model: selectedModel,
            statusCode: statusCode,
            originalError: errorMessage,
          }),
        };
      }

      // Enhanced rate limit handling with Claude-specific context
      if (statusCode === 429) {
        const retryAfter =
          error.response.headers["retry-after"] ||
          error.response.headers["x-ratelimit-reset-requests"] ||
          error.response.headers["x-ratelimit-reset"] ||
          60;

        // Determine rate limit type and provide specific guidance
        let rateLimitType = "requests_per_minute";
        let rateLimitDetails = "";
        let suggestion = "";

        if (errorMessage.includes("requests per minute")) {
          rateLimitType = "requests_per_minute";
          rateLimitDetails = "You're making too many requests per minute.";
          suggestion = selectedModel.startsWith("claude")
            ? "Claude free tier allows 5 RPM. Consider upgrading to Build Tier 1 (20 RPM) with $5 deposit."
            : "Consider spacing out your requests or upgrading your OpenAI tier.";
        } else if (errorMessage.includes("tokens per minute")) {
          rateLimitType = "tokens_per_minute";
          rateLimitDetails = "You're using too many tokens per minute.";
          suggestion = selectedModel.startsWith("claude")
            ? "Claude free tier allows 20,000 tokens/min. Consider Build Tier for higher limits."
            : "Reduce image sizes or use shorter prompts to stay within token limits.";
        } else if (errorMessage.includes("tokens per day")) {
          rateLimitType = "tokens_per_day";
          rateLimitDetails = "You've exceeded your daily token limit.";
          suggestion = selectedModel.startsWith("claude")
            ? "Claude free tier has daily limits. Consider upgrading for higher daily quotas."
            : "Wait for daily reset or upgrade your plan.";
        } else if (errorMessage.includes("quota")) {
          rateLimitType = "quota_exceeded";
          rateLimitDetails = "You've exceeded your account quota.";
          suggestion = selectedModel.startsWith("claude")
            ? "Check your usage tier at https://console.anthropic.com/settings/usage"
            : "Check your billing at https://platform.openai.com/usage";
        }

        return {
          statusCode: 429,
          body: JSON.stringify({
            error: `Rate limit exceeded. ${rateLimitDetails}`,
            type: "rate_limit_error",
            retryAfter: parseInt(retryAfter),
            rateLimitType: rateLimitType,
            details: rateLimitDetails,
            originalError: errorMessage,
            suggestion: suggestion,
            model: selectedModel,
          }),
        };
      }

      // Handle insufficient quota specifically
      if (statusCode === 403 || errorMessage.includes("insufficient_quota")) {
        return {
          statusCode: 403,
          body: JSON.stringify({
            error:
              "Insufficient quota. Please check your billing and plan limits.",
            type: "quota_error",
            suggestion:
              "Visit https://platform.openai.com/usage to check your usage and billing.",
            originalError: errorMessage,
          }),
        };
      }

      // Handle other API errors
      return {
        statusCode: statusCode,
        body: JSON.stringify({
          error: errorMessage,
          type: "api_error",
          statusCode: statusCode,
          suggestion:
            statusCode >= 500
              ? "API service issue, please try again later."
              : "Please check your request.",
          originalError: errorData,
        }),
      };
    }

    // Handle network and other errors
    let errorType = "server_error";
    let suggestion = "Please try again.";

    if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      errorType = "network_error";
      suggestion =
        "Network connection issue. Please check your internet connection.";
    } else if (error.code === "ETIMEDOUT") {
      errorType = "timeout_error";
      suggestion = "Request timed out. Please try again with a smaller image.";
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal server error: " + error.message,
        type: errorType,
        suggestion: suggestion,
        code: error.code,
      }),
    };
  }
};
