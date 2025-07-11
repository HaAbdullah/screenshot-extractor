const axios = require("axios");

exports.handler = async function (event, context) {
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
    const selectedModel = body.selectedModel || "gpt-4.1-nano";

    if (!imageBase64) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No image data provided" }),
      };
    }

    console.log(`Processing file: ${filename} with model: ${selectedModel}`);

    let response;
    const startTime = Date.now();

    // Determine which API to use based on the selected model
    if (selectedModel.startsWith("gpt-4") || selectedModel === "gpt-4o-mini") {
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

      // Enhanced rate limit handling with more context
      if (statusCode === 429) {
        const retryAfter =
          error.response.headers["retry-after"] ||
          error.response.headers["x-ratelimit-reset-requests"] ||
          error.response.headers["x-ratelimit-reset"] ||
          60;

        // Determine rate limit type for better client handling
        let rateLimitType = "requests_per_minute"; // Default assumption
        let rateLimitDetails = "";

        if (errorMessage.includes("requests per minute")) {
          rateLimitType = "requests_per_minute";
          rateLimitDetails = "You're making too many requests per minute.";
        } else if (errorMessage.includes("tokens per minute")) {
          rateLimitType = "tokens_per_minute";
          rateLimitDetails = "You're using too many tokens per minute.";
        } else if (errorMessage.includes("requests per day")) {
          rateLimitType = "requests_per_day";
          rateLimitDetails = "You've exceeded your daily request limit.";
        } else if (errorMessage.includes("quota")) {
          rateLimitType = "quota_exceeded";
          rateLimitDetails = "You've exceeded your account quota.";
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
            suggestion:
              rateLimitType === "quota_exceeded"
                ? "Please check your billing and plan limits at https://platform.openai.com/usage"
                : "Please wait before making more requests.",
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
