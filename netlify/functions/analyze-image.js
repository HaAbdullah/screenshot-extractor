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
    const selectedModel = body.selectedModel || "gpt-4.1-mini";

    if (!imageBase64) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No image data provided" }),
      };
    }

    console.log(`Processing file: ${filename} with model: ${selectedModel}`);

    let response;

    // Determine which API to use based on the selected model
    if (
      selectedModel === "gpt-4o-mini" ||
      selectedModel === "gpt-4o" ||
      selectedModel === "gpt-4.1-mini"
    ) {
      // OpenAI API call - use optimized model selection
      let modelToUse = selectedModel;

      // Map to best available models with better rate limits
      if (selectedModel === "gpt-4o") {
        modelToUse = "gpt-4.1-mini"; // Better rate limits and performance
      } else if (selectedModel === "gpt-4.1-mini") {
        modelToUse = "gpt-4.1-mini"; // Latest model with best rate limits
      }

      console.log(`Using OpenAI model: ${modelToUse}`);

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
                  text: "Analyze this image and extract text information visible such as: names, company names, job titles, and professional credentials. Format the information as:\nName: [...]\nCompany: [...]\nRole: [...]\nCredentials: [...]\n\nFor multiple entries, separate with a blank line. For anything that's not visible, simply write '-' for consistency. Be thorough and extract ALL visible people.",
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
          // Add stream: false to ensure we get complete responses
          stream: false,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          timeout: 45000, // 45 second timeout to match frontend
          // Add retry configuration for axios
          validateStatus: function (status) {
            // Accept 2xx and specific error codes we want to handle
            return (status >= 200 && status < 300) || status === 429;
          },
        }
      );

      // Handle rate limiting response specifically
      if (response.status === 429) {
        const retryAfter =
          response.headers["retry-after"] ||
          response.headers["x-ratelimit-reset-requests"] ||
          60;

        // Extract more specific error info from OpenAI response
        const errorData = response.data;
        const errorMessage = errorData.error?.message || "Rate limit exceeded";

        console.error(`Rate limit hit: ${errorMessage}`);

        return {
          statusCode: 429,
          headers: {
            "Retry-After": retryAfter.toString(),
            "X-RateLimit-Type": "openai-requests",
          },
          body: JSON.stringify({
            error: `Rate limit exceeded: ${errorMessage}`,
            type: "rate_limit_error",
            retryAfter: parseInt(retryAfter),
            originalError: errorMessage,
            suggestion:
              "Consider upgrading your OpenAI tier or waiting longer between requests",
          }),
        };
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          text: response.data.choices[0].message.content,
          filename: filename,
          model: modelToUse,
          usage: response.data.usage || null,
        }),
      };
    } else {
      // OpenRouter API call for other models
      const openRouterEndpoint =
        "https://openrouter.ai/api/v1/chat/completions";

      console.log(`Using OpenRouter model: ${selectedModel}`);

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
                  text: "Extract the full name, company name, job role, and professional credentials for ALL people visible in this image. If there are multiple people, list each person separately with a blank line between them. Format exactly as:\nName: [...]\nCompany: [...]\nRole: [...]\nCredentials: [...]\n\nName: [...]\nCompany: [...]\nRole: [...]\nCredentials: [...]\n\nand so on for each person. Be thorough and accurate.",
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
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "HTTP-Referer":
              process.env.APP_URL || "https://screenshot-analyzer.netlify.app",
            "X-Title": "Screenshot Analyzer",
          },
          timeout: 45000,
          validateStatus: function (status) {
            return (status >= 200 && status < 300) || status === 429;
          },
        }
      );

      // Handle OpenRouter rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers["retry-after"] || 60;
        const errorData = response.data;
        const errorMessage = errorData.error?.message || "Rate limit exceeded";

        console.error(`OpenRouter rate limit: ${errorMessage}`);

        return {
          statusCode: 429,
          headers: {
            "Retry-After": retryAfter.toString(),
            "X-RateLimit-Type": "openrouter",
          },
          body: JSON.stringify({
            error: `OpenRouter rate limit: ${errorMessage}`,
            type: "rate_limit_error",
            retryAfter: parseInt(retryAfter),
            originalError: errorMessage,
          }),
        };
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          text: response.data.choices[0].message.content,
          filename: filename,
          model: selectedModel,
          usage: response.data.usage || null,
        }),
      };
    }
  } catch (error) {
    console.error(`Error processing image: ${error.message}`);

    // Handle timeout errors specifically
    if (error.code === "ECONNABORTED" || error.message.includes("timeout")) {
      return {
        statusCode: 504,
        body: JSON.stringify({
          error:
            "Analysis timed out. Please try with a smaller image or try again.",
          isTimeout: true,
          type: "timeout_error",
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

      // Enhanced rate limit handling for different scenarios
      if (statusCode === 429) {
        const retryAfter =
          error.response.headers["retry-after"] ||
          error.response.headers["x-ratelimit-reset-requests"] ||
          60;

        // Determine rate limit type for better user guidance
        let rateLimitType = "unknown";
        let suggestion = "Please wait and try again";

        if (errorMessage.includes("requests per minute")) {
          rateLimitType = "requests_per_minute";
          suggestion =
            "You're sending requests too quickly. Wait at least 25 seconds between requests.";
        } else if (errorMessage.includes("tokens per minute")) {
          rateLimitType = "tokens_per_minute";
          suggestion =
            "Your account has reached the token limit. Try smaller images or wait for the limit to reset.";
        } else if (errorMessage.includes("requests per day")) {
          rateLimitType = "requests_per_day";
          suggestion =
            "Daily request limit reached. Upgrade your OpenAI plan or wait until tomorrow.";
        } else if (errorMessage.includes("Limit: 3")) {
          rateLimitType = "tier_1_limit";
          suggestion =
            "Your account is on Tier 1 (3 requests/min). Consider upgrading your OpenAI tier by making a payment.";
        }

        return {
          statusCode: 429,
          headers: {
            "Retry-After": retryAfter.toString(),
            "X-RateLimit-Type": rateLimitType,
          },
          body: JSON.stringify({
            error: `Rate limit exceeded (${rateLimitType}): ${errorMessage}`,
            type: "rate_limit_error",
            retryAfter: parseInt(retryAfter),
            rateLimitType: rateLimitType,
            originalError: errorMessage,
            suggestion: suggestion,
          }),
        };
      }

      // Handle insufficient quota errors
      if (statusCode === 402 || errorMessage.includes("insufficient_quota")) {
        return {
          statusCode: 402,
          body: JSON.stringify({
            error:
              "Insufficient quota. Please add credit to your OpenAI account.",
            type: "quota_error",
            originalError: errorMessage,
            suggestion:
              "Add funds to your OpenAI account at https://platform.openai.com/account/billing",
          }),
        };
      }

      // Handle other API errors
      return {
        statusCode: statusCode,
        body: JSON.stringify({
          error: errorMessage,
          type: "api_error",
          originalError: errorData,
        }),
      };
    }

    // Handle network and other errors
    if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      return {
        statusCode: 503,
        body: JSON.stringify({
          error: "Service temporarily unavailable. Please try again.",
          type: "network_error",
        }),
      };
    }

    // Handle other errors
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal server error: " + error.message,
        type: "server_error",
      }),
    };
  }
};
