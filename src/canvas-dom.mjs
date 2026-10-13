import { createCanvas } from '@napi-rs/canvas'
import { pathToFileURL } from 'node:url'

const COMPUTED_KEYS = new Set(['color', 'fontSize', 'fontFamily', 'fontWeight', 'opacity', 'width', 'height'])

function domError(message, hint) {
  const err = new Error(message)
  err.code = 'unsupported-dom'
  err.hint = hint
  return err
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function datasetName(key) {
  return key
    .slice(5)
    .replace(/-([a-zA-Z])/g, (_, letter) => letter.toUpperCase())
}

function issueFrom(err, path) {
  if (err && err.code === 'unsupported-dom') {
    return {
      level: 'error',
      code: 'unsupported-dom',
      path,
      message: err.message,
      hint: err.hint,
    }
  }
  const detail = err instanceof Error ? err.message : String(err)
  const syntax = err instanceof SyntaxError
  return {
    level: 'error',
    code: 'invalid-script',
    path,
    message: syntax ? `script 语法错误: ${detail}` : `script 运行出错: ${detail}`,
    hint: syntax ? '检查 JavaScript 语法' : '检查脚本。其余内容仍会绘制',
  }
}

/**
 * 一份给 `<script>` 用的文档。只暴露 querySelector、getElementById、
 * getContext('2d')、getComputedStyle、dataset、requestAnimationFrame、
 * performance.now、getBoundingClientRect 和 devicePixelRatio。
 */
export function createCanvasSession(input) {
  const issues = []
  const timeMs = input.timeMs
  const dpr = input.dpr
  let currentPath = 'layer'
  const queue = []
  let nextFrame = 1
  const hosts = []

  for (const spec of input.canvases) {
    const bitmapW = Math.max(1, Math.round(spec.bitmapWidth || spec.width || 300))
    const bitmapH = Math.max(1, Math.round(spec.bitmapHeight || spec.height || 150))
    const canvas = createCanvas(bitmapW, bitmapH)
    const ctx = canvas.getContext('2d')
    if (spec.rgba) {
      const bytes = Buffer.from(spec.rgba, 'base64')
      const image = ctx.createImageData(canvas.width, canvas.height)
      image.data.set(bytes.subarray(0, image.data.length))
      ctx.putImageData(image, 0, 0)
    }
    const attrs = { ...spec.attrs }
    const dataset = {}
    for (const [key, value] of Object.entries(attrs)) {
      if (!key.startsWith('data-') || key.length < 6) continue
      dataset[datasetName(key)] = value
    }
    const host = {
      path: spec.path,
      canvas,
      ctx,
      cssWidth: spec.width,
      cssHeight: spec.height,
      cssX: spec.x,
      cssY: spec.y,
      id: spec.id ?? '',
      text: spec.text ?? '',
      attrs,
      dataset,
      style: { ...spec.style },
      computed: spec.computed,
    }
    hosts.push(host)
  }

  function record(err) {
    const item = issueFrom(err, currentPath)
    if (input.sources?.[currentPath]) item.source = input.sources[currentPath]
    issues.push(item)
  }

  function findById(id) {
    return hosts.find((host) => host.id === id) ?? null
  }

  function querySelector(selector) {
    if (typeof selector !== 'string') {
      throw domError('querySelector 需要字符串', '写成 document.querySelector("#bar") 或 document.querySelector("canvas")')
    }
    const text = selector.trim()
    if (text === 'canvas') return hosts[0] ? elementOf(hosts[0]) : null
    const id = text.startsWith('#') ? text.slice(1) : text.startsWith('canvas#') ? text.slice('canvas#'.length) : null
    if (id == null || id.includes(' ') || id.includes('.') || id.includes('[')) {
      throw domError(
        `不支持选择器 ${text}`,
        '只用 #id、canvas 或 canvas#id。例如 document.querySelector("#bar")',
      )
    }
    const host = findById(id)
    return host ? elementOf(host) : null
  }

  function getElementById(id) {
    if (typeof id !== 'string') {
      throw domError('getElementById 需要字符串', '写成 document.getElementById("bar")')
    }
    const host = findById(id)
    return host ? elementOf(host) : null
  }

  function elementOf(host) {
    if (host.element) return host.element
    const element = {
      get id() {
        return host.id
      },
      set id(value) {
        host.id = String(value)
      },
      get width() {
        return host.canvas.width
      },
      set width(value) {
        const next = Number(value)
        host.canvas.width = Number.isFinite(next) && next > 0 ? Math.round(next) : 300
      },
      get height() {
        return host.canvas.height
      },
      set height(value) {
        const next = Number(value)
        host.canvas.height = Number.isFinite(next) && next > 0 ? Math.round(next) : 150
      },
      get dataset() {
        return host.dataset
      },
      get style() {
        return host.style
      },
      get textContent() {
        return host.text
      },
      set textContent(value) {
        host.text = value == null ? '' : String(value)
      },
      getContext(type) {
        if (type !== '2d') {
          throw domError(
            `不支持 getContext(${JSON.stringify(type)})`,
            '只用 canvas.getContext("2d")',
          )
        }
        return host.ctx
      },
      getBoundingClientRect() {
        const width = host.cssWidth
        const height = host.cssHeight
        return {
          x: host.cssX,
          y: host.cssY,
          left: host.cssX,
          top: host.cssY,
          right: host.cssX + width,
          bottom: host.cssY + height,
          width,
          height,
        }
      },
      getAttribute(name) {
        if (typeof name !== 'string') return null
        if (name === 'id') return host.id
        if (name === 'width') return String(host.canvas.width)
        if (name === 'height') return String(host.canvas.height)
        if (Object.prototype.hasOwnProperty.call(host.attrs, name)) return host.attrs[name]
        const found = Object.keys(host.attrs).find((key) => key.toLowerCase() === name.toLowerCase())
        return found ? host.attrs[found] : null
      },
    }
    host.element = new Proxy(element, {
      get(target, prop, receiver) {
        if (typeof prop === 'symbol' || prop === 'then') return undefined
        if (prop in target) return Reflect.get(target, prop, receiver)
        throw domError(
          `不支持 canvas.${String(prop)}`,
          '可以用 id、width、height、dataset、style、textContent、getContext、getBoundingClientRect、getAttribute',
        )
      },
      set(target, prop, value, receiver) {
        if (prop === 'id' || prop === 'width' || prop === 'height' || prop === 'textContent') {
          return Reflect.set(target, prop, value, receiver)
        }
        throw domError(
          `不能设置 canvas.${String(prop)}`,
          '位图尺寸写 canvas.width 和 canvas.height。布局尺寸在排版时已经定了',
        )
      },
    })
    return host.element
  }

  function computedOf(el) {
    const host = hosts.find((item) => item.element === el)
    if (!host) {
      throw domError('getComputedStyle 只接受这里的 canvas', '传入 document.querySelector 得到的画布')
    }
    const view = {
      color: host.computed.color,
      fontSize: `${host.computed.fontSize}px`,
      fontFamily: host.computed.fontFamily,
      fontWeight: String(host.computed.fontWeight),
      opacity: String(host.computed.opacity),
      width: `${host.cssWidth}px`,
      height: `${host.cssHeight}px`,
    }
    return new Proxy(view, {
      get(target, prop) {
        if (typeof prop === 'symbol') return undefined
        if (COMPUTED_KEYS.has(prop)) return target[prop]
        throw domError(
          `getComputedStyle 没有 ${String(prop)}`,
          '可以读 color、fontSize、fontFamily、fontWeight、opacity、width、height',
        )
      },
    })
  }

  const document = new Proxy(
    {
      querySelector,
      getElementById,
    },
    {
      get(target, prop) {
        if (prop === 'querySelector' || prop === 'getElementById') return target[prop]
        if (typeof prop === 'symbol' || prop === 'then') return undefined
        throw domError(
          `不支持 document.${String(prop)}`,
          '可以用 document.querySelector 和 document.getElementById',
        )
      },
    },
  )

  function requestAnimationFrame(callback) {
    if (typeof callback !== 'function') {
      throw domError('requestAnimationFrame 需要函数', '写成 requestAnimationFrame((time) => { ... })，time 是这一帧的毫秒')
    }
    const id = nextFrame++
    queue.push({ id, callback, path: currentPath })
    return id
  }

  function cancelAnimationFrame(id) {
    const index = queue.findIndex((item) => item.id === id)
    if (index >= 0) queue.splice(index, 1)
  }

  function getComputedStyle(el) {
    return computedOf(el)
  }

  const saved = {}

  function installGlobals() {
    saved.random = Math.random
    saved.Date = globalThis.Date
    saved.performance = globalThis.performance
    saved.document = globalThis.document
    saved.devicePixelRatio = globalThis.devicePixelRatio
    saved.requestAnimationFrame = globalThis.requestAnimationFrame
    saved.cancelAnimationFrame = globalThis.cancelAnimationFrame
    saved.getComputedStyle = globalThis.getComputedStyle
    Math.random = mulberry32(input.seed >>> 0)
    const RealDate = saved.Date
    function FixedDate(...args) {
      if (!new.target) return args.length === 0 ? new RealDate(timeMs).toString() : RealDate(...args)
      if (args.length === 0) return new RealDate(timeMs)
      return new RealDate(...args)
    }
    FixedDate.now = () => timeMs
    FixedDate.parse = RealDate.parse
    FixedDate.UTC = RealDate.UTC
    FixedDate.prototype = RealDate.prototype
    globalThis.Date = FixedDate
    globalThis.performance = { now: () => timeMs }
    globalThis.document = document
    globalThis.devicePixelRatio = dpr
    globalThis.requestAnimationFrame = requestAnimationFrame
    globalThis.cancelAnimationFrame = cancelAnimationFrame
    globalThis.getComputedStyle = getComputedStyle
  }

  function restoreGlobals() {
    Math.random = saved.random
    globalThis.Date = saved.Date
    globalThis.performance = saved.performance
    globalThis.document = saved.document
    globalThis.devicePixelRatio = saved.devicePixelRatio
    globalThis.requestAnimationFrame = saved.requestAnimationFrame
    globalThis.cancelAnimationFrame = saved.cancelAnimationFrame
    globalThis.getComputedStyle = saved.getComputedStyle
  }

  function run(body, path) {
    currentPath = path
    let fn
    try {
      fn = new Function(body)
    } catch (err) {
      const item = issueFrom(err, path)
      if (input.sources?.[path]) item.source = input.sources[path]
      issues.push(item)
      return
    }
    try {
      fn()
    } catch (err) {
      record(err)
    }
  }

  function runFn(fn, path) {
    currentPath = path
    try {
      fn()
    } catch (err) {
      record(err)
    }
  }

  function flush() {
    const batch = queue.splice(0, queue.length)
    for (const item of batch) {
      currentPath = item.path
      try {
        item.callback(timeMs)
      } catch (err) {
        record(err)
      }
    }
    queue.length = 0
  }

  function live() {
    return hosts.map((host) => ({ path: host.path, canvas: host.canvas }))
  }

  function exportJSON() {
    return {
      issues,
      canvases: hosts.map((host) => {
        const image = host.ctx.getImageData(0, 0, host.canvas.width, host.canvas.height)
        return {
          path: host.path,
          width: host.canvas.width,
          height: host.canvas.height,
          rgba: Buffer.from(image.data).toString('base64'),
        }
      }),
    }
  }

  return { installGlobals, restoreGlobals, run, runFn, flush, issues, live, exportJSON }
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const raw = await readStdin()
  const input = JSON.parse(raw)
  const session = createCanvasSession(input)
  const log = console.log
  console.log = (...args) => console.error(...args)
  session.installGlobals()
  try {
    for (const script of input.scripts ?? []) session.run(script.body ?? '', script.path ?? 'layer')
    session.flush()
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    session.restoreGlobals()
    console.log = log
  }
  process.stdout.write(JSON.stringify(session.exportJSON()))
}
