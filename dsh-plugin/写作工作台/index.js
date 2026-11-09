/**
 * 写作工作台 · Host 半边
 *
 * 只做两件事：
 *   1. 探活本机 127.0.0.1 上的写作工作台服务（serve.py）；
 *   2. 用户点「启动工作台」时，把 python serve.py 拉起来（不弹浏览器、不显示黑窗）。
 *
 * 不读稿件、不写 数据\、不调用模型。所有内容仍归应用自己的 md / csv。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 插件放在 <项目>\dsh-plugin\写作工作台\，往上两级就是项目根。 */
const PACKAGE_ROOT = path.resolve(HERE, '..', '..')

export const inject = ['webServer']

function probe(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
      res.resume()
      resolve(true)
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
  })
}

function waitFor(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const tick = () => {
      if (Date.now() > deadline) return resolve(false)
      probe(port).then((ok) => {
        if (ok) return resolve(true)
        setTimeout(tick, 250)
      })
    }
    tick()
  })
}

function resolveProject(configured) {
  const candidates = []
  if (configured) candidates.push(String(configured))
  candidates.push(PACKAGE_ROOT)
  candidates.push(path.resolve(HERE, '..', '..', '..'))
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'serve.py'))) return dir
    } catch (err) {
      /* 换下一个 */
    }
  }
  return ''
}

export function apply(ctx, config = {}) {
  const port = Number(config['端口'] || 8777) || 8777
  const project = resolveProject(config['项目目录'])
  const origin = `http://127.0.0.1:${port}/`
  const logFile = project ? path.join(project, '.cache', '写作工作台-服务.log') : ''

  function send(res, status, value) {
    const raw = JSON.stringify(value)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(raw),
    })
    res.end(raw)
  }

  async function health(req, res) {
    send(res, 200, { running: await probe(port), url: origin, project, port })
  }

  async function start(req, res) {
    if (req.method !== 'POST') return send(res, 405, { running: false, error: '只接受 POST' })
    const type = String(req.headers['content-type'] || '')
    if (!type.startsWith('application/json')) {
      return send(res, 415, { running: false, error: '需要 application/json' })
    }
    if (await probe(port)) return send(res, 200, { running: true, started: false, url: origin })
    if (!project) {
      return send(res, 200, {
        running: false,
        started: false,
        url: origin,
        error: '找不到 serve.py。请双击「启动工作台.bat」，或在插件配置里填「项目目录」。',
      })
    }

    let out = 'ignore'
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true })
      out = fs.openSync(logFile, 'a')
    } catch (err) {
      out = 'ignore'
    }

    // 用 -c 包一层，只为把 webbrowser.open 换成空函数：从 Harness 启动时不弹浏览器窗口。
    const code = 'import serve;serve.webbrowser.open=lambda *a,**k:None;serve.main()'
    const bins = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']

    for (const bin of bins) {
      try {
        const child = spawn(bin, ['-c', code], {
          cwd: project,
          detached: true,
          windowsHide: true,
          stdio: ['ignore', out, out],
        })
        child.on('error', () => {})
        child.unref()
      } catch (err) {
        continue
      }
      if (await waitFor(port, 6000)) {
        return send(res, 200, { running: true, started: true, url: origin, log: logFile })
      }
    }

    send(res, 200, {
      running: false,
      started: false,
      url: origin,
      log: logFile,
      error: '没有起来。请双击「启动工作台.bat」，看它报什么错。',
    })
  }

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({ kind: 'exact', path: '/writer/health', handler: health }),
      ctx.webServer.register({ kind: 'exact', path: '/writer/start', handler: start }),
    ]
    return () => {
      for (const off of disposers) {
        try {
          off()
        } catch (err) {
          /* 已经卸掉 */
        }
      }
    }
  })
}
