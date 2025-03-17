// netlify/functions/analyze-image.js
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

    if (!imageBase64) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No image data provided" }),
      };
    }

    console.log(`Processing file: ${filename}`);

    // Use a shorter timeout for the axios request to avoid Netlify timeouts
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o", // Consider using gpt-4o-mini for faster responses
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
        timeout: 9000, // 9 second timeout (giving buffer for Netlify's 10s limit)
      }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        text: response.data.choices[0].message.content,
        filename: filename,
      }),
    };
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

    // Handle OpenAI API errors
    if (error.response && error.response.data) {
      const statusCode = error.response.status;
      const errorMessage =
        error.response.data.error?.message || error.response.statusText;

      console.error(`OpenAI API error (${statusCode}): ${errorMessage}`);

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
