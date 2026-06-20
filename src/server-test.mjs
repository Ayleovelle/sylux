// src/server-test.mjs —— 面板 server 自测(零 CLI,纯协议)。跑:node src/server-test.mjs
import { startPanel } from './server.mjs'
import { createHash } from 'node:crypto'
import { connect } from 'node:net'
import { get } from 'node:http'

let pass = 0, fail = 0
const ok = (n, c) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const httpGet = (url) => new Promise((res) => get(url, (r) => { let b = ''; r.on('data', (d) => b += d); r.on('end', () => res({ status: r.statusCode, body: b })) }).on('error', () => res({ status: 0, body: '' })))

// 解析单个 server→client 文本帧(不掩码)
function decodeFrame(buf) {
  const op = buf[0] & 0x0f
  let len = buf[1] & 0x7f, off = 2
  if (len === 126) { len = buf.readUInt16BE(2); off = 4 }
  else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10 }
  return { op, text: buf.slice(off, off + len).toString('utf8') }
}

const PORT = 7991
const panel = await startPanel({ task: '测试任务', playbook: 'red-blue', port: PORT })
console.log('— HTTP 鉴权 —')
const noTok = await httpGet(`http://127.0.0.1:${PORT}/`)
ok('无 token 访问页面 → 403', noTok.status === 403)
const okTok = await httpGet(panel.url)
ok('带 token 访问页面 → 200 且注入了 token', okTok.status === 200 && okTok.body.includes('__SYLUX_TOKEN__'))
ok('页面 HTML 未泄漏任何 provider/base_url', !/mouubox|base_url|api_key|sk-/.test(okTok.body))
const jsRes = await httpGet(`http://127.0.0.1:${PORT}/panel.js`)
ok('panel.js 可取', jsRes.status === 200 && jsRes.body.includes('WebSocket'))

console.log('— WS 握手 + 广播 —')
await new Promise((resolve) => {
  const key = Buffer.from('0123456789abcdef').toString('base64')
  const expectAccept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
  const sock = connect(PORT, '127.0.0.1', () => {
    sock.write(
      `GET /ws?token=${panel.token} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\n` +
      `Origin: http://127.0.0.1:${PORT}\r\n` +
      `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
    )
  })
  let phase = 'handshake', buf = Buffer.alloc(0)
  sock.on('data', (d) => {
    if (phase === 'handshake') {
      const s = d.toString('utf8')
      ok('握手返回 101', /101 Switching Protocols/.test(s))
      ok('Sec-WebSocket-Accept 正确(SHA1+GUID)', s.includes('Sec-WebSocket-Accept: ' + expectAccept))
      // 握手响应后可能粘连 snapshot 帧
      const idx = d.indexOf('\r\n\r\n') + 4
      buf = d.slice(idx)
      phase = 'frames'
      // 触发一条广播
      setTimeout(() => panel.broadcast({ round: 1, from: 'claude', role: 'critic', kind: 'critique', body: '<script>恶意</script>内容', evidence: ['证据:xss测试'], usage: { input_tokens: 10, output_tokens: 5 }, status: null, ts: 'now' }), 50)
      if (buf.length >= 2) handleFrames()
    } else { buf = Buffer.concat([buf, d]); handleFrames() }
  })
  let gotSnapshot = false, gotMsg = false
  function handleFrames() {
    while (buf.length >= 2) {
      const f = decodeFrame(buf)
      let consumed; let len = buf[1] & 0x7f
      if (len === 126) consumed = 4 + buf.readUInt16BE(2)
      else if (len === 127) consumed = 10 + Number(buf.readBigUInt64BE(2))
      else consumed = 2 + len
      if (buf.length < consumed) break
      buf = buf.slice(consumed)
      let obj; try { obj = JSON.parse(f.text) } catch { continue }
      if (obj.type === 'snapshot') { gotSnapshot = true; ok('snapshot 带 task/playbook', obj.task === '测试任务' && obj.playbook === 'red-blue') }
      if (obj.type === 'message') {
        gotMsg = true
        ok('广播 message 字段正确', obj.message.from === 'claude' && obj.message.evidence[0] === '证据:xss测试')
        ok('body 原文保留(转义在前端做)', obj.message.message === undefined && typeof obj.message.body === 'string')
        ok('广播帧不含 provider/usage 私字段', obj.message.usage && obj.message.usage.input_tokens === 10 && !('provider' in obj.message))
        finish()
      }
    }
  }
  let done = false
  function finish() {
    if (done) return; done = true
    ok('收到 snapshot', gotSnapshot); ok('收到 message', gotMsg)
    try { sock.end() } catch {}
    resolve()
  }
  setTimeout(finish, 3000)
})

panel.close()
console.log(`\n面板自测:${pass} 过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
