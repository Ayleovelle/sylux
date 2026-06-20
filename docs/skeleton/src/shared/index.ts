/**
 * @sylux/shared · index.ts
 *
 * 全项目唯一进入点(黑板协议 02 §11)。其他包【只从 @sylux/shared 导入】,
 * 不深引 blackboard.schema.ts(便于内部重构)。
 *
 * 用 .js 后缀(NodeNext / verbatimModuleSyntax,总体规划 §11.4);
 * type 导出与值导出分开(consistent-type-imports)。
 */

// ── schema + 推导类型(blackboard.schema.ts)──
export {
  SCHEMA_VERSION,
  MAX_MESSAGE_BYTES,
  MAX_JSONL_LINE_BYTES,
  MAX_FINGERPRINTS_PER_ROUND,
  roleSchema,
  messageKindSchema,
  agentIdSchema,
  evidenceItemSchema,
  filePatchSchema,
  messageSchema,
  agentMessagePayloadSchema,
  tokenUsageSchema,
  agentEventSchema,
  roundSchema,
  runStatusSchema,
  boardStateSchema,
  jsonlRecordSchema,
  buildAgentOutputJsonSchema,
  isValidStatusTransition,
  RUN_STATUS_TRANSITIONS,
  RUN_STATUS_INITIAL,
} from './blackboard.schema.js';
export type {
  SchemaVersion,
  Role,
  MessageKind,
  AgentId,
  EvidenceItem,
  FilePatch,
  Message,
  AgentMessagePayload,
  TokenUsage,
  AgentEvent,
  Round,
  RunStatus,
  BoardState,
  JsonlRecord,
} from './blackboard.schema.js';

// ── 校验(validate.ts)──
export { validateMessage, verifyEvidenceItem } from './validate.js';
export type { ValidateContext, ValidateResult, VerifyResult } from './validate.js';

// ── 指纹 / 哈希(fingerprint.ts)──
export { fingerprint, fingerprintSet, contentHash, normalizeContent } from './fingerprint.js';

// ── jsonl(jsonl.ts)──
export { encodeJsonlLine, decodeJsonlLine, decodeJsonlFile } from './jsonl.js';
export type { DecodeResult } from './jsonl.js';

// ── 错误码(errors.ts)──
export { SyluxError, SYLUX_ERROR_CODES, isSyluxErrorCode } from './errors.js';
export type { SyluxErrorCode } from './errors.js';
