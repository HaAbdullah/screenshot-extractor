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

    // Determine which API to use based on the selected model
    if (selectedModel === "gpt-4o-mini" || selectedModel === "gpt-4o") {
      // OpenAI API call - optimized for better performance
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
                  text: "Analyze this image and extract information for ALL people visible. For each person, provide:\nName: [full name if visible]\nCompany: [company/organization name]\nRole: [job title/position]\nCredentials: [degrees, certifications, etc.]\n\nIf multiple people are visible, separate each person with a blank line. Use '-' for any field that's not clearly visible. Be thorough and check the entire image carefully.",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: imageBase64,
                    detail: "high", // Request high detail for better text recognition
                  },
                },
              ],
            },
          ],
          max_tokens: 1500, // Increased for multiple people
          temperature: 0.1, // Lower temperature for more consistent extraction
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          timeout: 45000, // Increased timeout for complex images
          // Add retry configuration
          retry: {
            retries: 0, // We handle retries in the frontend
          },
        }
      );

      return {
        statusCode: 200,
        headers: {
          "Cache-Control": "no-cache", // Prevent caching of responses
        },
        body: JSON.stringify({
          text: response.data.choices[0].message.content,
          filename: filename,
          model: modelToUse,
          usage: response.data.usage, // Include usage stats for monitoring
        }),
      };
    } else {
      // OpenRouter API call for other models - optimized
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
                  text: "Extract information for ALL people visible in this image. For each person found, format exactly as:\n\nName: [full name]\nCompany: [company name]\nRole: [job title]\nCredentials: [certifications/degrees]\n\n[blank line]\n\nName: [next person's name]\nCompany: [next person's company]\nRole: [next person's role]\nCredentials: [next person's credentials]\n\nContinue this pattern for each person. Use '-' if information is not visible. Examine the entire image thoroughly.",
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
            "X-Title": "Screenshot Analyzer - Optimized",
          },
          timeout: 45000,
        }
      );

      return {
        statusCode: 200,
        headers: {
          "Cache-Control": "no-cache",
        },
        body: JSON.stringify({
          text: response.data.choices[0].message.content,
          filename: filename,
          model: selectedModel,
          usage: response.data.usage,
        }),
      };
    }
  } catch (error) {
    console.error(`Error processing image: ${error.message}`);
    console.error(`Error stack: ${error.stack}`);

    // Enhanced error handling with detailed logging
    if (error.code === "ECONNABORTED") {
      console.error("Request timeout occurred");
      return {
        statusCode: 504,
        body: JSON.stringify({
          error: "Request timed out. The image may be too large or complex.",
          type: "timeout_error",
          isTimeout: true,
          suggestion: "Try with a smaller image or different model",
        }),
      };
    }

    // Handle API errors with enhanced rate limit detection
    if (error.response && error.response.data) {
      const statusCode = error.response.status;
      const errorData = error.response.data;
      const errorMessage =
        errorData.error?.message || error.response.statusText;

      console.error(`API error (${statusCode}): ${errorMessage}`);
      console.error(
        "Error headers:",
        JSON.stringify(error.response.headers, null, 2)
      );
      console.error("Full error response:", JSON.stringify(errorData, null, 2));

      // Enhanced rate limit handling with specific detection
      if (statusCode === 429) {
        const retryAfter =
          error.response.headers["retry-after"] ||
          error.response.headers["x-ratelimit-reset-requests"] ||
          error.response.headers["x-ratelimit-reset-tokens"] ||
          60;

        // More detailed rate limit classification
        let rateLimitType = "unknown";
        let suggestedDelay = parseInt(retryAfter);

        if (
          errorMessage.includes("requests per minute") ||
          errorMessage.includes("RPM")
        ) {
          rateLimitType = "requests_per_minute";
          suggestedDelay = Math.max(60, suggestedDelay);
        } else if (
          errorMessage.includes("tokens per minute") ||
          errorMessage.includes("TPM")
        ) {
          rateLimitType = "tokens_per_minute";
          suggestedDelay = Math.max(30, suggestedDelay);
        } else if (
          errorMessage.includes("requests per day") ||
          errorMessage.includes("RPD")
        ) {
          rateLimitType = "requests_per_day";
          suggestedDelay = Math.max(3600, suggestedDelay); // 1 hour minimum for daily limits
        } else if (errorMessage.includes("concurrent")) {
          rateLimitType = "concurrent_requests";
          suggestedDelay = Math.max(10, suggestedDelay);
        }

        return {
          statusCode: 429,
          headers: {
            "Retry-After": suggestedDelay.toString(),
          },
          body: JSON.stringify({
            error: `Rate limit exceeded: ${errorMessage}`,
            type: "rate_limit_error",
            rateLimitType: rateLimitType,
            retryAfter: suggestedDelay,
            suggestion: `Please wait ${suggestedDelay} seconds before retrying`,
            originalError: errorMessage,
            timestamp: new Date().toISOString(),
          }),
        };
      }

      // Handle quota exceeded errors
      if (statusCode === 403 && errorMessage.includes("quota")) {
        return {
          statusCode: 403,
          body: JSON.stringify({
            error: "API quota exceeded",
            type: "quota_exceeded",
            suggestion: "Please check your API usage limits",
            originalError: errorMessage,
          }),
        };
      }

      // Handle authentication errors
      if (statusCode === 401) {
        return {
          statusCode: 401,
          body: JSON.stringify({
            error: "Authentication failed",
            type: "auth_error",
            suggestion: "Please check your API key configuration",
            originalError: errorMessage,
          }),
        };
      }

      // Handle other API errors
      return {
        statusCode: statusCode,
        body: JSON.stringify({
          error: `API Error: ${errorMessage}`,
          type: "api_error",
          statusCode: statusCode,
          originalError: errorData,
          suggestion:
            statusCode >= 500
              ? "This appears to be a server issue. Please try again in a few moments."
              : "Please check your request and try again.",
        }),
      };
    }

    // Handle network errors
    if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      return {
        statusCode: 503,
        body: JSON.stringify({
          error: "Network error - unable to reach API service",
          type: "network_error",
          suggestion: "Please check your internet connection and try again",
        }),
      };
    }

    // Handle other errors
    console.error("Unhandled error type:", error.code, error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal server error",
        type: "server_error",
        message: error.message,
        suggestion:
          "An unexpected error occurred. Please try again or contact support if the issue persists.",
        timestamp: new Date().toISOString(),
      }),
    };
  }
};
