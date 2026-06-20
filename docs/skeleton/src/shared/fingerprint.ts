/**
 * @sylux/shared · fingerprint.ts
 *
 * Evidence 指纹与内容哈希 ——【签名权威】(黑板协议 02 §9)。刹车 07 只调用、不另定义。
 *
 * 为什么权威落这里:指纹算法强耦合 `EvidenceItem` 结构(02 §0.2),
 * 故签名与归一化规则在契约层定权威,07 引用实现收敛差集(§9.3)。
 *
 * 算法即契约:`normalizeContent` + sha256-hex-16 是 `contentHash` 的权威定义。
 * 任何改动(换算法 / 改截断长度 / 改归一化规则)都是破坏性变更,
 * 必须 SCHEMA_VERSION+1(§1.2),否则旧 jsonl 里的 contentHash 全部失配。
 */

import { createHash } from 'node:crypto';
import type { EvidenceItem } from './blackboard.schema.js';

/** sha256 → hex(全长)。内部用,外部走 contentHash/stableHash。 */
function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * 文本归一化(contentHash 与指纹共用)。
 * 统一换行为 \n、去每行尾随空白、去首尾空行;不动行内语义空白。
 * Windows 必需:CRLF/CR → LF(事实地基 A),否则跨平台同区间算出不同 hash。
 */
export function normalizeContent(text: string): string {
  return text
    .replace(/\r\n?/g, '\n') // CRLF/CR → LF
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, '')) // 去行尾空白
    .join('\n')
    .replace(/^\n+|\n+$/g, ''); // 去首尾空行
}

/**
 * 区间内容哈希:归一化 → sha256 → hex 前 16 字符。
 * 碰撞概率足够低、体积友好。中枢核验时对【重读的真实区间内容】算(H1),
 * 不是 agent 自算 —— agent 填了也被中枢覆盖(I7)。
 */
export function contentHash(text: string): string {
  return sha256hex(normalizeContent(text)).slice(0, 16);
}

/** 稳定短哈希:用于把任意字符串(cmd/expected/source)压成定长指纹片段。 */
function stableHash(text: string): string {
  return sha256hex(text).slice(0, 16);
}

/**
 * 单条 evidence 的稳定指纹。同一锚点指向「同一事实」必得同一指纹,用于跨轮差集。
 *
 * 关键不变量(§9.2 / 焊死 H2 漏洞):
 * - `command` 分支【绝不】把 `actual` 喂进指纹 —— 否则对抗 agent 对同一命令每轮
 *   回填不同 actual 串即得不同指纹 → 永远「有新证据」→ stall 检测被绕过(打穿 R5)。
 *   指纹只取 cmd+expected+matchMode(「同一断言」)。
 * - `file_ref` 用中枢派生的 `contentHash`;未核验/无 quote 时留 `:?` 占位指纹
 *   (同区间反复提交不算「新」,避免空证据刷新 stall 计数)。
 */
export function fingerprint(e: EvidenceItem): string {
  switch (e.kind) {
    case 'file_ref':
      return e.contentHash
        ? `f:${e.path}:${e.lineStart}-${e.lineEnd}:${e.contentHash}`
        : `f:${e.path}:${e.lineStart}-${e.lineEnd}:?`;
    case 'command':
      // actual 不参与(H2):同一断言无论实测值都算同一「声明」。
      return `c:${stableHash(e.cmd)}:${stableHash(e.expected)}:${e.matchMode}`;
    case 'spec_quote':
      return `s:${stableHash(e.source)}:${stableHash(normalizeContent(e.quote))}`;
  }
}

/**
 * 一组 evidence 的指纹集合(去重),供 Round.evidenceFingerprints 缓存(§10.1)。
 * 在【轮末核验完成后】算,此时强 file_ref 的 contentHash 已由中枢回填,指纹稳定。
 * 集合条数受 MAX_FINGERPRINTS_PER_ROUND 限,超限截断(由调用侧 07 处理 + system 告警)。
 */
export function fingerprintSet(items: EvidenceItem[]): string[] {
  return [...new Set(items.map(fingerprint))];
}
