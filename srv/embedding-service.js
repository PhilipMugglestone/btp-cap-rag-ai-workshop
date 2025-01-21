"use strict";

const cds = require("@sap/cds");
const { v4: uuidv4 } = require('uuid');
const utils = require('./lib/utils');
const genAiHubConfig = cds.env.requires["GEN_AI_HUB_CONFIG"];
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { WebPDFLoader } = require("@langchain/community/document_loaders/web/pdf");

/**
 * Create PDF blob with content from the table
 */
async function getPdfBlob(stream) {
  const pdfBytes = [];
  // Collect streaming PDF content
  stream.on("data", (chunk) => {
    pdfBytes.push(chunk);
  });
  // Wait for the file content stream to finish
  await new Promise((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  const pdfBuffer = Buffer.concat(pdfBytes);
  return new Blob([pdfBuffer], { type: "application/pdf" });
}

/**
 * Split the document in multiple text chunks to be used in the embedding
 */
async function splitDocumentInTextChunks(pdfBlob) {
  const loader = new WebPDFLoader(pdfBlob, {});
  const document = await loader.load();
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 100,
    addStartIndex: true,
  });
  return splitter.splitDocuments(document);
}

/**
 * Convert text chunks to vector (embedding)
 */
async function getEmbeddingPayload(textChunks, filename) {
  const textChunkEntries = [];
  // Generate embedding for each text chunk
  for (const chunk of textChunks) {
    const entry = {
      text_chunk: chunk.pageContent,
      metadata_column: filename,
      embedding: array2VectorBuffer(await utils.getEmbedding(chunk.pageContent))
    };
    textChunkEntries.push(entry);
  }
  return textChunkEntries;
}

/**
 * Embedding document process
 */
async function embeddingDocument(data, entities) {
  const { Files, DocumentChunk } = entities;
  const result = await cds
    .read(Files)
    .columns(["fileName"])
    .where({ ID: data.ID });
  if (result.length === 0) {
    throw new Error(`Document ${data.ID} not found!`);
  }
  try {
    const pdfBlob = await getPdfBlob(data.content);
    const textChunks = await splitDocumentInTextChunks(pdfBlob);
    const fileName = result[0].fileName;
    if (genAiHubConfig["USE_HANA_EMBEDDING"]) {
      const db = await cds.connect.to('db');
      for (const chunk of textChunks) {
        // to be investigated - single quotes in doc
        const pageContent = chunk.pageContent.replaceAll("'", "");
        const query = `INSERT INTO "BTPCAPRAGAI_DOCUMENTCHUNK" VALUES ('${uuidv4()}', '${pageContent}', '${fileName}', VECTOR_EMBEDDING('${pageContent}', 'DOCUMENT', '${genAiHubConfig["EMBEDDING_MODEL_HANA"]}'))`;
        const status = await db.run(query);
        if (!status) {
          throw new Error("Insertion of text chunks into db failed!");
        }
      }
    } else {
      const textChunkEntries = await getEmbeddingPayload(
        textChunks,
        fileName
      );
      // Insert the embedded text chunks into db
      const status = await INSERT.into(DocumentChunk).entries(textChunkEntries);
      if (!status) {
        throw new Error("Insertion of text chunks into db failed!");
      }
    }
  } catch (err) {
    throw new Error(
      `Error while generating and storing vector embeddings: ${err?.message}`,
      {
        cause: err,
      }
    );
  }
}

/**
 * Convert embeddings to buffer, required to store it in SAP HANA tables
 */
function array2VectorBuffer(data) {
  const sizeFloat = 4;
  const sizeDimensions = 4;
  const bufferSize = data.length * sizeFloat + sizeDimensions;
  const buffer = Buffer.allocUnsafe(bufferSize);
  buffer.writeUInt32LE(data.length, 0);
  data.forEach((value, index) => {
    buffer.writeFloatLE(value, index * sizeFloat + sizeDimensions);
  });
  return buffer;
}
module.exports = class EmbeddingService extends cds.ApplicationService {
  init() {
    const { Files, DocumentChunk } = this.entities;

    this.on("UPDATE", Files, async (req) => {
      await embeddingDocument(req.data, this.entities);
    });

    this.on("deleteEmbeddings", async () => {
      try {
        await Promise.all([cds.delete(Files), cds.delete(DocumentChunk)]);
      } catch (err) {
        throw new Error(
          `Error deleting the embeddings from db: ${err?.message}`,
          {
            cause: err,
          }
        );
      }
    });

    return super.init();
  }
};
