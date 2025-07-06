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
    const selectedModel = body.selectedModel || "gpt-4o-mini";

    if (!imageBase64) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No image data provided" }),
      };
    }

    console.log(`Processing file: ${filename} with model: ${selectedModel}`);

    let response;
    let responseHeaders = {};

    // Determine which API to use based on the selected model
    if (selectedModel === "gpt-4o-mini" || selectedModel === "gpt-4o") {
      // OpenAI API call - use gpt-4o-mini for better rate limits
      const modelToUse =
        selectedModel === "gpt-4o" ? "gpt-4o-mini" : selectedModel;

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

      // Extract rate limit headers from OpenAI response
      if (response.headers) {
        responseHeaders = {
          "x-ratelimit-remaining-requests":
            response.headers["x-ratelimit-remaining-requests"],
          "x-ratelimit-remaining-tokens":
            response.headers["x-ratelimit-remaining-tokens"],
          "x-ratelimit-reset-requests":
            response.headers["x-ratelimit-reset-requests"],
          "x-ratelimit-reset-tokens":
            response.headers["x-ratelimit-reset-tokens"],
        };
      }

      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers":
            "x-ratelimit-remaining-requests, x-ratelimit-remaining-tokens, x-ratelimit-reset-requests, x-ratelimit-reset-tokens",
          ...responseHeaders,
        },
        body: JSON.stringify({
          text: response.data.choices[0].message.content,
          filename: filename,
          rateLimitInfo: responseHeaders,
        }),
      };
    } else {
      // OpenRouter API call for other models
      const openRouterEndpoint =
        "https://openrouter.ai/api/v1/chat/completions";

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
              process.env.APP_URL || "https://screenshot-analyzer.netlify.app",
            "X-Title": "Screenshot Analyzer",
          },
          timeout: 30000,
        }
      );

      // Extract rate limit headers from OpenRouter response if available
      if (response.headers) {
        responseHeaders = {
          "x-ratelimit-remaining-requests":
            response.headers["x-ratelimit-remaining-requests"],
          "x-ratelimit-reset-requests":
            response.headers["x-ratelimit-reset-requests"],
        };
      }

      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers":
            "x-ratelimit-remaining-requests, x-ratelimit-reset-requests",
          ...responseHeaders,
        },
        body: JSON.stringify({
          text: response.data.choices[0].message.content,
          filename: filename,
          rateLimitInfo: responseHeaders,
        }),
      };
    }
  } catch (error) {
    console.error(`Error processing image: ${error.message}`);

    // Handle timeout errors specifically
    if (error.code === "ECONNABORTED") {
      return {
        statusCode: 504,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          error: "Analysis timed out. Please try with a smaller image.",
          isTimeout: true,
        }),
      };
    }

    // Handle API errors with enhanced rate limit handling
    if (error.response && error.response.data) {
      const statusCode = error.response.status;
      const errorData = error.response.data;
      const errorMessage =
        errorData.error?.message || error.response.statusText;

      console.error(`API error (${statusCode}): ${errorMessage}`);
      console.error("Full error response:", JSON.stringify(errorData, null, 2));

      // Enhanced rate limit handling
      if (statusCode === 429) {
        const retryAfter =
          error.response.headers["retry-after"] ||
          error.response.headers["x-ratelimit-reset-requests"] ||
          60;

        // Check if it's a specific OpenAI rate limit type
        let rateLimitType = "unknown";
        if (errorMessage.includes("requests per minute")) {
          rateLimitType = "requests_per_minute";
        } else if (errorMessage.includes("tokens per minute")) {
          rateLimitType = "tokens_per_minute";
        } else if (errorMessage.includes("requests per day")) {
          rateLimitType = "requests_per_day";
        }

        return {
          statusCode: 429,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Retry-After": retryAfter.toString(),
          },
          body: JSON.stringify({
            error: `Rate limit exceeded (${rateLimitType}). ${errorMessage}`,
            type: "rate_limit_error",
            retryAfter: parseInt(retryAfter),
            rateLimitType: rateLimitType,
            originalError: errorMessage,
          }),
        };
      }

      // Handle other API errors
      return {
        statusCode: statusCode,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          error: errorMessage,
          type: "api_error",
          originalError: errorData,
        }),
      };
    }

    // Handle other errors
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "Internal server error: " + error.message,
        type: "server_error",
      }),
    };
  }
};
