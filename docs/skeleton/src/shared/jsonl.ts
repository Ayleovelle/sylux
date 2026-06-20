/**
 * @sylux/shared · jsonl.ts
 *
 * 持久化行的 encode/decode + 版本迁移(黑板协议 02 §7)。
 *
 * 黑板持久化:单文件 append-only jsonl,每 run 一份 runs/<runId>.jsonl,
 * 每行一个独立 JSON 对象(无逗号、无外层数组),崩溃可截断到最后完整行恢复(§7.3)。
 * 这是回放(面板时间旅行)与审计的权威源;BoardState 由本日志投影重建(§7.3),不独立落盘。
 */

import {
  jsonlRecordSchema,
  MAX_JSONL_LINE_BYTES,
  SCHEMA_VERSION,
  type JsonlRecord,
} from './blackboard.schema.js';

/** decode 结果:判别联合,绝不抛进引擎(I2 守门)。 */
export type DecodeResult =
  | { ok: true; record: JsonlRecord }
  | { ok: false; error: string; raw: string };

/**
 * 序列化单行:parse(盖章校验)→ JSON.stringify + 换行。
 * 禁止内嵌裸换行(JSON 转义保证单行)。超 MAX_JSONL_LINE_BYTES 抛(调用侧应已在
 * message 层用 MAX_MESSAGE_BYTES 拦住,这里是 jsonl 行总闸的最后一道)。
 */
export function encodeJsonlLine(rec: JsonlRecord): string {
  const line = JSON.stringify(jsonlRecordSchema.parse(rec)) + '\n';
  // TODO(02 §7.3): 用 Buffer.byteLength 算 UTF-8 字节而非 .length(字符数);超限走打回链。
  if (Buffer.byteLength(line, 'utf8') > MAX_JSONL_LINE_BYTES) {
    throw new Error(`jsonl line exceeds MAX_JSONL_LINE_BYTES (${MAX_JSONL_LINE_BYTES})`);
  }
  return line;
}

/**
 * 解析单行 → 经迁移 → safeParse。返回判别结果,绝不抛进引擎。
 * 超长行(写到一半崩 / 失控 agent)先判残行,不进 JSON.parse 以免 OOM。
 */
export function decodeJsonlLine(line: string): DecodeResult {
  if (Buffer.byteLength(line, 'utf8') > MAX_JSONL_LINE_BYTES) {
    return { ok: false, error: 'JSONL_LINE_TOO_LARGE', raw: line };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, error: 'INVALID_JSON', raw: line };
  }
  const migrated = migrateRecord(parsed); // §7.4
  const r = jsonlRecordSchema.safeParse(migrated);
  return r.success ? { ok: true, record: r.data } : { ok: false, error: r.error.message, raw: line };
}

/**
 * 把任意旧版本记录就地升到当前 SCHEMA_VERSION。每次 +1 加一个分支。
 * 迁移原则:只升不降,每条记录自带 schemaVersion(不靠全局推断)。
 * 破坏性变更(删字段 / 改 contentHash 算法 / 改行结构,§1.2)必须 SCHEMA_VERSION+1
 * 并补一个 migrateV{n-1}toV{n} 分支 + 对应回放快照测试(§13 V18–V20)。
 */
function migrateRecord(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const v = (raw as { schemaVersion?: number }).schemaVersion ?? 0;
  let rec = raw;
  // 版本提升链,逐级搬运。当前仅 v1,无迁移分支。
  // if (v < 1) rec = migrateV0toV1(rec);
  // if (v < 2) rec = migrateV1toV2(rec);
  void v;
  void SCHEMA_VERSION;
  return rec;
}

/**
 * 批量解析整份 jsonl 内容 → 记录数组 + 末行截断恢复(§7.3)。
 * 读到最后一行若 decode 失败(写到一半崩),丢弃该残行,前面完整行即权威态。
 * 中间行 decode 失败视为日志损坏,调用侧应告警(非末行残缺通常意味着更严重问题)。
 *
 * TODO(02 §7.3): BoardState 投影(run_started 建壳 → message 归桶 → round_closed 填 rounds →
 *   agent_session 填 sessionId/resumable → status_changed 末态)归引擎 03 的 Blackboard 接口,
 *   本函数只负责「行 → JsonlRecord[]」这一层,不做投影。
 */
export function decodeJsonlFile(
  content: string,
): { records: JsonlRecord[]; truncatedTail: boolean; corruptLines: number } {
  const lines = content.split('\n').filter((l) => l.length > 0);
  const records: JsonlRecord[] = [];
  let truncatedTail = false;
  let corruptLines = 0;
  const lastIdx = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue; // noUncheckedIndexedAccess 窄化
    const r = decodeJsonlLine(line);
    if (r.ok) {
      records.push(r.record);
    } else if (i === lastIdx) {
      truncatedTail = true; // 末行残缺:崩溃截断,可恢复
    } else {
      corruptLines++; // 中间行损坏:异常,调用侧告警
    }
  }
  return { records, truncatedTail, corruptLines };
}
