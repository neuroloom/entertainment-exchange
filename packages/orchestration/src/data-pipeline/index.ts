// Data Pipeline — Moat 3: Proprietary Data Network Effects
// Embedding indexer builds similarity graphs from domain entity text
// Fraud detector uses cross-tenant scanning to widen detection moat
export { EmbeddingIndexer } from './embedding-indexer.js';
export { FraudDetector } from './fraud-detector.js';
export type {
  DomainEmbedding,
  SimilarityEdge,
} from './embedding-indexer.js';
export type {
  FraudDetectorIndicator,
  FraudDetectorStores,
} from './fraud-detector.js';
