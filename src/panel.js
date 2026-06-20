// panel.js —— sylux 观战前端(原生 WS,无框架)。所有 agent 内容经 esc() 转义后进 DOM。
(function () {
  const $ = (id) => document.getElementById(id)
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  // token 由 server 注入到 window.__SYLUX_TOKEN__,WS URL 带上做一次性鉴权
  const token = window.__SYLUX_TOKEN__ || ''
  const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?token=' + encodeURIComponent(token)

  let totalTok = 0
  const ROLE_LABEL = { author: '作者', critic: '红队', lead: '主控', worker: '执行', navigator: '领航', driver: '驾驶' }

  function setConn(txt, cls) { const e = $('conn'); e.textContent = txt; e.className = 'pill ' + (cls || 'live') }
  function setStop(reason) {
    const map = { CONVERGED: ['done', '已收敛'], CONVERGENCE_STALL: ['stall', '停滞收口'], MAX_ROUNDS: ['done', '达轮数上限'] }
    const m = map[reason] || ['err', reason]
    const e = $('pb'); e.textContent = m[1]; e.className = 'pill ' + m[0]
  }

  function addMsg(m) {
    if (m.usage) totalTok += (m.usage.input_tokens || 0) + (m.usage.output_tokens || 0)
    $('tok').textContent = 'token ≈ ' + totalTok
    const div = document.createElement('div')
    const isStatus = m.kind === 'status_changed'
    div.className = 'msg r-' + esc(m.role) + (isStatus ? ' status-row' : '')
    const u = m.usage ? `<span class="usage">in ${m.usage.input_tokens ?? '?'} / out ${m.usage.output_tokens ?? '?'}</span>` : ''
    const st = m.status?.code ? `<span class="pill err">${esc(m.status.code)}</span>` : ''
    let ev = ''
    if (m.evidence && m.evidence.length && !isStatus) {
      ev = '<div class="ev">' + m.evidence.map((e) => `<div>· ${esc(e)}</div>`).join('') + '</div>'
    }
    div.innerHTML =
      `<div class="hd"><span class="who">${esc(m.from)}</span>` +
      `<span>第 ${esc(m.round)} 轮 · ${esc(ROLE_LABEL[m.role] || m.role)} · ${esc(m.kind)}</span>${st}${u}</div>` +
      `<div class="body">${esc(m.body)}</div>${ev}`
    $('log').appendChild(div)
    window.scrollTo(0, document.body.scrollHeight)
  }

  function connect() {
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => setConn('已连接', 'live')
    ws.onclose = () => { setConn('已断开', 'err'); setTimeout(connect, 2000) }
    ws.onerror = () => setConn('连接错误', 'err')
    ws.onmessage = (ev) => {
      let f; try { f = JSON.parse(ev.data) } catch { return }
      if (f.type === 'snapshot') {
        $('pb').textContent = f.playbook || '—'
        $('task').textContent = '任务:' + (f.task || '')
        $('log').innerHTML = ''; totalTok = 0
        ;(f.messages || []).forEach(addMsg)
      } else if (f.type === 'message') {
        addMsg(f.message)
      } else if (f.type === 'end') {
        setStop(f.stopReason)
        $('foot').textContent = `结束 · 停因 ${f.stopReason} · ${f.rounds} 轮 · 累计 token ≈ ${f.totalUsage} · 耗时 ${f.sec}s`
      }
    }
  }
  connect()
})()
