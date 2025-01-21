"use strict";

const genAiHubConfig = cds.env.requires["GEN_AI_HUB_CONFIG"];

/**
 * Get embedding via Gen AI Hub foundation model
 * query, payload and response are model specific
 * https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/consume-generative-ai-models-using-sap-ai-core
 */
async function getEmbedding(input) {
    try {
        const destService = await cds.connect.to(`${genAiHubConfig["DESTINATION_NAME"]}`);
        const query = `POST /inference/deployments/${genAiHubConfig["EMBEDDING_MODEL_DEPLOYMENT_ID"]}/embeddings?api-version=2024-10-21`;
        const headers = {
            "Content-Type": "application/json",
            "AI-Resource-Group": `${genAiHubConfig["RESOURCE_GROUP"]}`,
        };
        const payload = {
            input: input
        };
        const response = await destService.send({
            headers: headers,
            query: query,
            data: payload
        });
        if (response) {
            const embedding = response?.data[0]?.embedding;
            return embedding;
        } else {
            throw new Error("getEmbedding: Empty response received");
        }
    }
    catch (error) {
        throw error;
    }
}

/**
 * Perform similarity search
 * recommended algorithm and sort order settings:
 *  COSINE_SIMILARITY DESC
 *  L2DISTANCE        ASC
 */
async function similaritySearch(userQuery, topN, algorithm, sortOrder) {
    try {
        let embedding = [];
        if (!genAiHubConfig["USE_HANA_EMBEDDING"]) {
            // embed user query via model
            embedding = await getEmbedding(userQuery);
        }
        const db = await cds.connect.to('db');
        let query = `SELECT TOP ${topN} TO_NVARCHAR("TEXT_CHUNK") AS "PAGE_CONTENT", ${algorithm}("EMBEDDING", `;
        if (genAiHubConfig["USE_HANA_EMBEDDING"]) {
            query+= `VECTOR_EMBEDDING('${userQuery}', 'QUERY', '${genAiHubConfig["EMBEDDING_MODEL_HANA"]}')`;
        } else {
            query+= `TO_REAL_VECTOR('[${embedding.toString()}]')`;
        }
        query+= `) AS "SCORE" FROM "BTPCAPRAGAI_DOCUMENTCHUNK" ORDER BY "SCORE" ${sortOrder}`;
        const response = await db.run(query);
        //console.log(response);
        const similarContent = response.map(
            (obj) => obj.PAGE_CONTENT
        );
        return similarContent;
    }
    catch (error) {
        throw error;
    }
}

/**
 * Get chat response via Gen AI Hub foundation model
 * query, payload and response are model specific
 * https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/consume-generative-ai-models-using-sap-ai-core
 */
async function getChatResponse(chatInstructionPrompt, similarContent, chatHistory, userQuery) {
    try {
        const destService = await cds.connect.to(`${genAiHubConfig["DESTINATION_NAME"]}`);
        const query = `POST /inference/deployments/${genAiHubConfig["CHAT_MODEL_DEPLOYMENT_ID"]}/chat/completions?api-version=2024-10-21`;
        const headers = {
            "Content-Type": "application/json",
            "AI-Resource-Group": `${genAiHubConfig["RESOURCE_GROUP"]}`,
        };
        let messagePayload = [
            {
            "role": "system",
            "content": ` ${chatInstructionPrompt} \`\`\` ${similarContent} \`\`\` `
            }
        ];
        if (chatHistory.length > 0) {
            messagePayload.push(...chatHistory);
        }
        messagePayload.push({
            "role": "user",
            "content": `${userQuery}`
        })
        let payload = {
            "messages": messagePayload
        };
        payload.max_tokens = 100;
        payload.temperature = 0.0;
        payload.frequency_penalty = 0;
        payload.presence_penalty = 0;
        const response = await destService.send({
            headers: headers,
            query: query,
            data: payload
        });
        if (response) {
            return response;
        } else {
            throw new Error("getChatResponse: Empty response received");
        }
    }
    catch (error) {
        throw error;
    }
}

module.exports = {
    getEmbedding: getEmbedding,
    similaritySearch: similaritySearch,
    getChatResponse: getChatResponse
};
