/**
 * 写作工作台 · Client 半边
 *
 * 1. 侧边栏加一个「写作工作台」面板图标（sidebar.panellist）；
 * 2. 主区整幅显示现有工作台（main 面板 + iframe 指向本机 8777）。
 *
 * 页面本体、样式、脚本全部复用现有应用，这里只负责入口和「服务没开」时的启动卡。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-writer-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'writer-workbench'
    const APP_URL = 'http://127.0.0.1:8777/'
    const ZH = typeof navigator !== 'undefined' && /^zh/i.test(String(navigator.language || ''))

    const T = ZH
      ? {
          title: '写作工作台',
          running: '本地服务运行中',
          checking: '正在连接…',
          starting: '正在启动…',
          stopped: '服务未启动',
          openBrowser: '在浏览器打开',
          reload: '重新载入',
          stoppedTitle: '本地服务还没有启动',
          stoppedHint:
            '写作工作台跑在本机 127.0.0.1:8777 的 Python 服务上。点「启动工作台」，我替你拉起来；也可以继续双击「启动工作台.bat」。',
          startingHint: '正在调用 python serve.py，通常 2–5 秒，最多等十几秒。',
          startService: '启动工作台',
          checkAgain: '重新检测',
          startFailed: '没有起来。请双击「启动工作台.bat」，看它报什么错。',
        }
      : {
          title: 'Writing Workbench',
          running: 'Local service running',
          checking: 'Connecting…',
          starting: 'Starting…',
          stopped: 'Service stopped',
          openBrowser: 'Open in browser',
          reload: 'Reload',
          stoppedTitle: 'The local service is not running',
          stoppedHint:
            'The workbench is served by the Python service on 127.0.0.1:8777. Click "Start workbench" and I will launch it; you can also keep using 启动工作台.bat.',
          startingHint: 'Running python serve.py — usually 2–5 seconds, up to ~15 seconds.',
          startService: 'Start workbench',
          checkAgain: 'Check again',
          startFailed: 'It did not start. Run 启动工作台.bat and read the error there.',
        }

    const CSS = [
      '.dsh-writer-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}',
      '.dsh-writer-bar{display:flex;align-items:center;gap:8px;flex:0 0 auto;padding:0 12px;height:36px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dsh-writer-title{font-weight:600}',
      '.dsh-writer-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary)}',
      '.dsh-writer-dot.on{background:var(--dsw-alias-state-success-primary)}',
      '.dsh-writer-dot.wait{background:var(--dsw-alias-state-warn-primary)}',
      '.dsh-writer-state{color:var(--dsw-alias-label-secondary)}',
      '.dsh-writer-spacer{flex:1 1 auto}',
      '.dsh-writer-btn{font:inherit;color:var(--dsw-alias-label-primary);background:transparent;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:3px 10px;cursor:pointer}',
      '.dsh-writer-btn:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsh-writer-btn[disabled]{opacity:.55;cursor:default}',
      '.dsh-writer-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}',
      '.dsh-writer-frame{flex:1 1 auto;width:100%;min-height:0;border:0;display:block;background:var(--dsw-alias-bg-base)}',
      '.dsh-writer-empty{flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:24px}',
      '.dsh-writer-card{max-width:440px;padding:24px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);text-align:center}',
      '.dsh-writer-card-title{font-size:15px;font-weight:600;margin-bottom:8px}',
      '.dsh-writer-card-text{color:var(--dsw-alias-label-secondary);line-height:1.6;margin:0 0 14px}',
      '.dsh-writer-card-error{color:var(--dsw-alias-state-error-primary);line-height:1.5;margin:0 0 14px;word-break:break-all}',
      '.dsh-writer-card-actions{display:flex;gap:8px;justify-content:center}',
    ].join('')

    function PenIcon(props) {
      const size = props && props.size ? props.size : 20
      const active = !!(props && props.active)
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block', pointerEvents: 'none', opacity: active ? 1 : 0.72 },
        },
        h('path', {
          d: 'M4.5 19.5h3.6L18.4 9.2a2.05 2.05 0 0 0-2.9-2.9L5.2 16.6l-.7 2.9z',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M14.2 7.6l2.9 2.9',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
      )
    }

    function Workbench() {
      const [phase, setPhase] = React.useState('checking')
      const [message, setMessage] = React.useState('')
      const [reloadKey, setReloadKey] = React.useState(0)

      const check = React.useCallback(async () => {
        setPhase('checking')
        try {
          const res = await fetch('/writer/health', { cache: 'no-store' })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const data = await res.json()
          setMessage('')
          setPhase(data && data.running ? 'ready' : 'down')
        } catch (err) {
          setMessage(String((err && err.message) || err))
          setPhase('error')
        }
      }, [])

      React.useEffect(() => {
        check()
      }, [check])

      const startService = React.useCallback(async () => {
        setPhase('starting')
        setMessage('')
        try {
          const res = await fetch('/writer/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
          const data = await res.json().catch(() => ({}))
          if (data && data.running) {
            setReloadKey((k) => k + 1)
            setPhase('ready')
          } else {
            setMessage((data && data.error) || T.startFailed)
            setPhase('down')
          }
        } catch (err) {
          setMessage(String((err && err.message) || err))
          setPhase('error')
        }
      }, [])

      const stateText =
        phase === 'ready'
          ? T.running
          : phase === 'checking'
            ? T.checking
            : phase === 'starting'
              ? T.starting
              : T.stopped

      const children = [
        h('style', { key: 'style', dangerouslySetInnerHTML: { __html: CSS } }),
        h(
          'div',
          { key: 'bar', className: 'dsh-writer-bar' },
          h('span', { className: 'dsh-writer-title' }, T.title),
          h('span', {
            className:
              'dsh-writer-dot' +
              (phase === 'ready' ? ' on' : phase === 'checking' || phase === 'starting' ? ' wait' : ''),
          }),
          h('span', { className: 'dsh-writer-state' }, stateText),
          h('span', { className: 'dsh-writer-spacer' }),
          h(
            'button',
            {
              className: 'dsh-writer-btn',
              type: 'button',
              onClick: () => window.open(APP_URL, '_blank', 'noopener'),
            },
            T.openBrowser,
          ),
          h(
            'button',
            {
              className: 'dsh-writer-btn',
              type: 'button',
              onClick: () => {
                setReloadKey((k) => k + 1)
                check()
              },
            },
            T.reload,
          ),
        ),
      ]

      if (phase === 'ready') {
        children.push(
          h('iframe', {
            key: 'frame-' + reloadKey,
            className: 'dsh-writer-frame',
            src: APP_URL,
            title: T.title,
            allow: 'clipboard-read; clipboard-write',
          }),
        )
      } else {
        children.push(
          h(
            'div',
            { key: 'empty', className: 'dsh-writer-empty' },
            h(
              'div',
              { className: 'dsh-writer-card' },
              h('div', { className: 'dsh-writer-card-title' }, phase === 'starting' ? T.starting : T.stoppedTitle),
              h('p', { className: 'dsh-writer-card-text' }, phase === 'starting' ? T.startingHint : T.stoppedHint),
              message ? h('p', { className: 'dsh-writer-card-error' }, message) : null,
              h(
                'div',
                { className: 'dsh-writer-card-actions' },
                h(
                  'button',
                  {
                    className: 'dsh-writer-btn primary',
                    type: 'button',
                    disabled: phase === 'starting',
                    onClick: startService,
                  },
                  phase === 'starting' ? T.starting : T.startService,
                ),
                h('button', { className: 'dsh-writer-btn', type: 'button', onClick: check }, T.checkAgain),
              ),
            ),
          ),
        )
      }

      return h('div', { className: 'dsh-writer-root' }, children)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const offIcon = ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => T.title },
              PenIcon,
            ),
          )
          const offPanel = ctx.slots.inject('main', () =>
            ctx.slots.register({ name: 'main', key: PANEL_ID }, Workbench),
          )
          return () => {
            offIcon()
            offPanel()
          }
        })
      },
    }
  },
})
