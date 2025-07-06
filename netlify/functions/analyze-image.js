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
    const selectedModel = body.selectedModel || "gpt-4o-mini"; // Updated default

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
          temperature: 0.3, // Lower temperature for more consistent responses
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          timeout: 15000, // Increased timeout to 15 seconds
        }
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          text: response.data.choices[0].message.content,
          filename: filename,
        }),
      };
    } else {
      // OpenRouter API call for other models
      const openRouterEndpoint =
        "https://openrouter.ai/api/v1/chat/completions";

      response = await axios.post(
        openRouterEndpoint,
        {
          model: selectedModel, // Either "qwen/qwen-vl-plus" or "google/gemma-3-12b-it:free"
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
              process.env.APP_URL || "https://screenshot-analyzer.netlify.app", // Required by OpenRouter
            "X-Title": "Screenshot Analyzer", // Optional: app name
          },
          timeout: 15000,
        }
      );

      return {
        statusCode: 200,
        body: JSON.stringify({
          text: response.data.choices[0].message.content,
          filename: filename,
        }),
      };
    }
  } catch (error) {
    console.error(`Error processing image: ${error.message}`);

    // Handle timeout errors specifically
    if (error.code === "ECONNABORTED") {
      return {
        statusCode: 504,
        body: JSON.stringify({
          error: "Analysis timed out. Please try with a smaller image.",
          isTimeout: true,
        }),
      };
    }

    // Handle API errors with specific rate limit handling
    if (error.response && error.response.data) {
      const statusCode = error.response.status;
      const errorMessage =
        error.response.data.error?.message || error.response.statusText;

      console.error(`API error (${statusCode}): ${errorMessage}`);

      // Special handling for rate limit errors
      if (statusCode === 429) {
        const retryAfter = error.response.headers["retry-after"] || 60;
        return {
          statusCode: 429,
          body: JSON.stringify({
            error: `Rate limit exceeded. Please wait ${retryAfter} seconds before retrying.`,
            type: "rate_limit_error",
            retryAfter: retryAfter,
          }),
        };
      }

      return {
        statusCode: statusCode,
        body: JSON.stringify({
          error: errorMessage,
          type: "api_error",
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
