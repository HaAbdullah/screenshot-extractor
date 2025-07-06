const axios = require("axios");

exports.handler = async function (event, context) {
  // Ensure the request is a POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  try {
    // Parse the request body
    const body = JSON.parse(event.body);
    const imageBase64 = body.imageBase64;
    const filename = body.filename || "unknown";
    const selectedModel = body.selectedModel || "gpt-4o-mini";

    if (!imageBase64) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
        },
        body: JSON.stringify({ error: "No image data provided" }),
      };
    }

    console.log(`Processing file: ${filename} with model: ${selectedModel}`);
    console.log(`Image data length: ${imageBase64.length} characters`);

    let response;

    // Determine which API to use based on the selected model
    if (selectedModel === "gpt-4o-mini" || selectedModel === "gpt-4o") {
      // OpenAI API call - use gpt-4o-mini for better rate limits
      const modelToUse =
        selectedModel === "gpt-4o" ? "gpt-4o-mini" : selectedModel;

      console.log(`Making OpenAI API call with model: ${modelToUse}`);

      try {
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
                    text: "Analyze this image and extract text information visible such as: names, company names, job titles, and professional credentials. Format the information as:\nName: [...]\nCompany: [...]\nRole: [...]\nCredentials: [...]\n\nFor multiple entries, separate with a blank line. For anything thats not visible, simply write '-' for consistency.",
                  },
                  {
                    type: "image_url",
                    image_url: { url: imageBase64 },
                  },
                ],
              },
            ],
            max_tokens: 1000,
            temperature: 0.3,
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            timeout: 30000, // 30 seconds timeout
          }
        );

        console.log(`OpenAI API response received for ${filename}`);

        return {
          statusCode: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
          },
          body: JSON.stringify({
            text: response.data.choices[0].message.content,
            filename: filename,
            model: modelToUse,
          }),
        };
      } catch (openaiError) {
        console.error(`OpenAI API error for ${filename}:`, openaiError.message);

        if (openaiError.response) {
          console.error(
            `OpenAI API error details:`,
            JSON.stringify(openaiError.response.data, null, 2)
          );
        }

        throw openaiError; // Re-throw to be handled by the main catch block
      }
    } else {
      // OpenRouter API call for other models
      const openRouterEndpoint =
        "https://openrouter.ai/api/v1/chat/completions";

      console.log(`Making OpenRouter API call with model: ${selectedModel}`);

      try {
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
                    text: "Extract the full name, company name, job role, and professional credentials for ALL people visible in this image. If there are multiple people, list each person separately with a blank line between them. Format exactly as:\nName: [...]\nCompany: [...]\nRole: [...]\nCredentials: [...]\n\nName: [...]\nCompany: [...]\nRole: [...]\nCredentials: [...]\n\nand so on for each person.",
                  },
                  {
                    type: "image_url",
                    image_url: { url: imageBase64 },
                  },
                ],
              },
            ],
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
              "HTTP-Referer":
                process.env.APP_URL ||
                "https://screenshot-analyzer.netlify.app",
              "X-Title": "Screenshot Analyzer",
            },
            timeout: 30000,
          }
        );

        console.log(`OpenRouter API response received for ${filename}`);

        return {
          statusCode: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
          },
          body: JSON.stringify({
            text: response.data.choices[0].message.content,
            filename: filename,
            model: selectedModel,
          }),
        };
      } catch (openRouterError) {
        console.error(
          `OpenRouter API error for ${filename}:`,
          openRouterError.message
        );

        if (openRouterError.response) {
          console.error(
            `OpenRouter API error details:`,
            JSON.stringify(openRouterError.response.data, null, 2)
          );
        }

        throw openRouterError; // Re-throw to be handled by the main catch block
      }
    }
  } catch (error) {
    console.error(
      `Error processing image ${body?.filename || "unknown"}: ${error.message}`
    );

    // Handle timeout errors specifically
    if (error.code === "ECONNABORTED" || error.message.includes("timeout")) {
      console.error(`Timeout error for ${body?.filename || "unknown"}`);
      return {
        statusCode: 504,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
        },
        body: JSON.stringify({
          error:
            "Analysis timed out. Please try with a smaller image or try again later.",
          type: "timeout_error",
          isTimeout: true,
        }),
      };
    }

    // Handle API errors with enhanced rate limit handling
    if (error.response && error.response.data) {
      const statusCode = error.response.status;
      const errorData = error.response.data;
      const errorMessage =
        errorData.error?.message ||
        errorData.message ||
        error.response.statusText ||
        "Unknown API error";

      console.error(
        `API error (${statusCode}) for ${
          body?.filename || "unknown"
        }: ${errorMessage}`
      );
      console.error("Full error response:", JSON.stringify(errorData, null, 2));

      // Enhanced rate limit handling
      if (statusCode === 429) {
        const retryAfter =
          error.response.headers["retry-after"] ||
          error.response.headers["x-ratelimit-reset-requests"] ||
          error.response.headers["x-ratelimit-reset"] ||
          60;

        // Check if it's a specific OpenAI rate limit type
        let rateLimitType = "unknown";
        let detailedMessage = errorMessage;

        if (errorMessage.includes("requests per minute")) {
          rateLimitType = "requests_per_minute";
        } else if (errorMessage.includes("tokens per minute")) {
          rateLimitType = "tokens_per_minute";
        } else if (errorMessage.includes("requests per day")) {
          rateLimitType = "requests_per_day";
        } else if (errorMessage.includes("quota")) {
          rateLimitType = "quota_exceeded";
        }

        // Provide more helpful error messages
        if (rateLimitType === "requests_per_minute") {
          detailedMessage =
            "Too many requests per minute. Please wait before uploading more images.";
        } else if (rateLimitType === "quota_exceeded") {
          detailedMessage =
            "API quota exceeded. Please check your OpenAI account or try again later.";
        }

        console.error(`Rate limit hit (${rateLimitType}): ${detailedMessage}`);

        return {
          statusCode: 429,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Retry-After": retryAfter.toString(),
          },
          body: JSON.stringify({
            error: detailedMessage,
            type: "rate_limit_error",
            retryAfter: parseInt(retryAfter),
            rateLimitType: rateLimitType,
            originalError: errorMessage,
          }),
        };
      }

      // Handle authentication errors
      if (statusCode === 401) {
        console.error(`Authentication error: ${errorMessage}`);
        return {
          statusCode: 401,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
          },
          body: JSON.stringify({
            error:
              "API authentication failed. Please check API key configuration.",
            type: "auth_error",
          }),
        };
      }

      // Handle other API errors
      return {
        statusCode: statusCode,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
        },
        body: JSON.stringify({
          error: errorMessage,
          type: "api_error",
          statusCode: statusCode,
        }),
      };
    }

    // Handle network and other errors
    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
      console.error(`Network error: ${error.message}`);
      return {
        statusCode: 503,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
        },
        body: JSON.stringify({
          error: "Unable to connect to AI service. Please try again later.",
          type: "network_error",
        }),
      };
    }

    // Handle other errors
    console.error(`Unexpected error: ${error.message}`);
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: JSON.stringify({
        error: "Internal server error. Please try again later.",
        type: "server_error",
        details: error.message,
      }),
    };
  }
};
