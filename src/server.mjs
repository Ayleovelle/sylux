// src/server.mjs —— sylux 观战面板 server。零依赖原生 WebSocket(RFC 6455)。
// 安全:只绑 127.0.0.1;每次启动生成一次性 token,页面与 /ws 都要带;校验 Origin;
//   只广播黑板消息字段(round/from/role/kind/body/evidence/usage/status),绝不外泄 provider/key。
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

// —— WS 帧编码(server→client,不掩码)——
function encodeFrame(str) {
  const payload = Buffer.from(str, 'utf8')
  const len = payload.length
  let header
  if (len < 126) {
    header = Buffer.from([0x81, len])
  } else if (len < 65536) {
    header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, payload])
}
// 最小入站帧解析:只关心 close(0x8)/ping(0x9),数据帧忽略(观战只读)。client 帧必带掩码。
function parseOpcode(buf) {
  if (buf.length < 2) return null
  return buf[0] & 0x0f
}

// 把一条消息裁成只含可公开的字段(白名单),杜绝把 provider/timeout/内部对象广播出去。
function publicMsg(m) {
  return {
    round: m.round, from: m.from, role: m.role, kind: m.kind,
    body: m.body, evidence: m.evidence || [],
    usage: m.usage ? { input_tokens: m.usage.input_tokens, output_tokens: m.usage.output_tokens } : null,
    status: m.status ? { code: m.status.code } : null,
    ts: m.ts,
  }
}

// 启动面板。返回 { url, token, broadcast(msg), end(summary), close() }。
export function startPanel({ task = '', playbook = '', port = 7878, host = '127.0.0.1' } = {}) {
  const token = randomBytes(16).toString('hex')
  const clients = new Set()
  const history = []                 // 已广播消息(给新连接做 snapshot)
  let ended = null                   // 结束摘要(晚连的也能看到结果)

  const htmlRaw = readFileSync(join(__dir, 'panel.html'), 'utf8')
  const panelJs = readFileSync(join(__dir, 'panel.js'), 'utf8')

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`)
    if (url.pathname === '/' ) {
      if (url.searchParams.get('token') !== token) { res.writeHead(403).end('forbidden: bad token'); return }
      // token 注入页面,供前端 WS 鉴权
      const html = htmlRaw.replace('<script src="/panel.js">', `<script>window.__SYLUX_TOKEN__=${JSON.stringify(token)}</script>\n<script src="/panel.js">`)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff' }).end(html)
    } else if (url.pathname === '/panel.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }).end(panelJs)
    } else {
      res.writeHead(404).end('not found')
    }
  })

  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, `http://${host}:${port}`)
    // 鉴权:token 必对
    if (url.pathname !== '/ws' || url.searchParams.get('token') !== token) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return
    }
    // Origin 校验:只允许本机面板页(同 host:port)发起,挡跨站 WS 劫持
    const origin = req.headers.origin
    if (origin && origin !== `http://${host}:${port}` && origin !== `http://localhost:${port}`) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return
    }
    const key = req.headers['sec-websocket-key']
    if (!key) { socket.destroy(); return }
    const accept = createHash('sha1').update(key + WS_GUID).digest('base64')
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    )
    clients.add(socket)
    // 初连快照:历史全量 + 结束摘要(若已结束)
    socket.write(encodeFrame(JSON.stringify({ type: 'snapshot', task, playbook, messages: history })))
    if (ended) socket.write(encodeFrame(JSON.stringify({ type: 'end', ...ended })))

    socket.on('data', (buf) => {
      const op = parseOpcode(buf)
      if (op === 0x8) { try { socket.end() } catch {} ; clients.delete(socket) } // close
    })
    socket.on('close', () => clients.delete(socket))
    socket.on('error', () => clients.delete(socket))
  })

  function send(obj) {
    const frame = encodeFrame(JSON.stringify(obj))
    for (const c of clients) { try { c.write(frame) } catch { clients.delete(c) } }
  }

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const url = `http://${host}:${port}/?token=${token}`
      resolve({
        url, token,
        broadcast(msg) { const pm = publicMsg(msg); history.push(pm); send({ type: 'message', message: pm }) },
        end(summary) { ended = summary; send({ type: 'end', ...summary }) },
        close() { for (const c of clients) { try { c.end() } catch {} } server.close() },
      })
    })
  })
}
