"use strict";

const cds = require("@sap/cds");
const utils = require('./lib/utils');
const chatHistoryInMemory = [];

/**
 * Get chat history session
 */
function getChatHistorySession(sessionId) {
  if (!chatHistoryInMemory[sessionId]) {
    chatHistoryInMemory[sessionId] = [];
  }
  return chatHistoryInMemory[sessionId];
}

/**
 * Get RAG response
 */
async function getRagResponse(userQuery, chatHistory) {

  const chatInstructionPrompt = `You are a chatbot.
  Answer the user question based only on the context, delimited by triple backticks.
  If you don't know the answer, just say that you don't know.`;

  // perform similarity search
  const similarContent = await utils.similaritySearch(userQuery, 3, "COSINE_SIMILARITY", "DESC");
  //console.log("similar content:", similarContent);

  // get chat response
  const chatResponse = await utils.getChatResponse(chatInstructionPrompt, similarContent, chatHistory, userQuery);
  //console.log("chat response:", chatResponse);

  // prepare full response
  const fullResponse = {
    completion: chatResponse,
    additionalContents: similarContent
  };

  return fullResponse;

}

/**
 * Prepare response from AI
 */
function prepareResponse(ragResponse) {
  return {
    role: ragResponse.completion.choices[0].message.role,
    content: ragResponse.completion.choices[0].message.content,
    timestamp: new Date().toJSON(),
    additionalContents: ragResponse.additionalContents,
  };
}

/**
 * Add messages to the chat history session
 */
function addMessagesToChatHistory(sessionId, userContent, assistantContent) {
  chatHistoryInMemory[sessionId].push({
    role: "user",
    content: userContent,
  });
  chatHistoryInMemory[sessionId].push({
    role: "assistant",
    content: assistantContent,
  });
}
module.exports = class Chat extends cds.ApplicationService {
  init() {
    this.on("getAiResponse", async (req) => {
      try {
        const userQuery = req.data?.content;
        const chatHistory = getChatHistorySession(req.data.sessionId);
        const ragResponse = await getRagResponse(userQuery, chatHistory);
        const response = prepareResponse(ragResponse);
        addMessagesToChatHistory(
          req.data.sessionId,
          userQuery,
          response.content
        );
        return response;
      } catch (err) {
        throw new Error(
          `Error generating response for user query: ${err?.message}`,
          {
            cause: err,
          }
        );
      }
    });

    this.on("deleteChatSession", async (req) => {
      const index = chatHistoryInMemory.indexOf(req.params.sessionId);
      if (index !== -1) {
        delete chatHistoryInMemory[index];
        chatHistoryInMemory.splice(index, 1);
      }
    });

    return super.init();
  }
};
