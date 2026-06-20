/**
 * @sylux/shared · types.ts
 *
 * 【任务别名入口】立项简报点名要 `src/shared/types.ts`;但黑板协议 02 §1.1/§14 焊死
 * 不变量 I1「单一权威」——Message/Evidence/Round/BoardState/AgentEvent/kind 的 z.object/
 * z.enum/z.discriminatedUnion 有且只有一处定义,物理落 `blackboard.schema.ts`。
 *
 * 为同时满足两者:本文件【不另写任何定义】,只把权威定义透传出去(re-export),
 * 等价于 index.ts。下游既可 `from '@sylux/shared'` 也可 `from '@sylux/shared/types.js'`,
 * 拿到的都是 blackboard.schema.ts 的同一份权威 schema/类型。grep `from:.*agentIdSchema`
 * 全仓仍只命中 blackboard.schema.ts 一处(I1 不破)。
 */

export * from './index.js';
