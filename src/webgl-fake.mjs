/**
 * WebGL1 / WebGL2 命令记录器。缓冲、纹理、帧缓冲、程序和状态先记下。
 * drawArrays / drawElements 在调用时拷贝属性和 uniform，真正的光栅留到
 * readPixels、flush、finish，或画布被 getImageData 读取时一次执行。
 * 读 position、normal、uv、color，以及 modelViewMatrix、projectionMatrix、
 * normalMatrix、diffuse、opacity、roughness、metalness、emissive、shininess、
 * transmission、map。three.js 0.160 起的内置材质按 SHADER_TYPE 和 USE_* 识别，
 * 金属度、粗糙度、透射走和 `<model>` 同一套种类。更早的版本报 unsupported-webgl。
 * 没有矩阵时，坐标都在 -1 到 1 里就按裁剪空间投影到视口。
 * 否则属性 0 是像素坐标，y 向下，属性 1 是平面颜色。
 * 三角形没有盖住画布时报 unsupported-webgl。
 * 画布上的三角形走网格那条路：Rust 画进 MESH_SAMPLES 倍的缓冲，再 resolveGrid 缩回。
 */
import { MESH_SAMPLES, fakeClear, fakeDraw, parseShaderProgram, resolveGrid, webglDraw } from './tri-raster.mjs'

const GL = {
  DEPTH_BUFFER_BIT: 0x00000100,
  STENCIL_BUFFER_BIT: 0x00000400,
  COLOR_BUFFER_BIT: 0x00004000,
  POINTS: 0x0000,
  LINES: 0x0001,
  LINE_LOOP: 0x0002,
  LINE_STRIP: 0x0003,
  TRIANGLES: 0x0004,
  TRIANGLE_STRIP: 0x0005,
  TRIANGLE_FAN: 0x0006,
  ZERO: 0,
  ONE: 1,
  SRC_COLOR: 0x0300,
  ONE_MINUS_SRC_COLOR: 0x0301,
  SRC_ALPHA: 0x0302,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  DST_ALPHA: 0x0304,
  ONE_MINUS_DST_ALPHA: 0x0305,
  DST_COLOR: 0x0306,
  ONE_MINUS_DST_COLOR: 0x0307,
  SRC_ALPHA_SATURATE: 0x0308,
  FUNC_ADD: 0x8006,
  BLEND_EQUATION: 0x8009,
  BLEND_EQUATION_RGB: 0x8009,
  BLEND_EQUATION_ALPHA: 0x883d,
  FUNC_SUBTRACT: 0x800a,
  FUNC_REVERSE_SUBTRACT: 0x800b,
  BLEND_DST_RGB: 0x80c8,
  BLEND_SRC_RGB: 0x80c9,
  BLEND_DST_ALPHA: 0x80ca,
  BLEND_SRC_ALPHA: 0x80cb,
  CONSTANT_COLOR: 0x8001,
  ONE_MINUS_CONSTANT_COLOR: 0x8002,
  CONSTANT_ALPHA: 0x8003,
  ONE_MINUS_CONSTANT_ALPHA: 0x8004,
  BLEND_COLOR: 0x8005,
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  ARRAY_BUFFER_BINDING: 0x8894,
  ELEMENT_ARRAY_BUFFER_BINDING: 0x8895,
  STREAM_DRAW: 0x88e0,
  STATIC_DRAW: 0x88e4,
  DYNAMIC_DRAW: 0x88e8,
  FRONT: 0x0404,
  BACK: 0x0405,
  FRONT_AND_BACK: 0x0408,
  TEXTURE_2D: 0x0de1,
  CULL_FACE: 0x0b44,
  BLEND: 0x0be2,
  DITHER: 0x0bd0,
  STENCIL_TEST: 0x0b90,
  DEPTH_TEST: 0x0b71,
  SCISSOR_TEST: 0x0c11,
  POLYGON_OFFSET_FILL: 0x8037,
  SAMPLE_ALPHA_TO_COVERAGE: 0x809e,
  SAMPLE_COVERAGE: 0x80a0,
  NO_ERROR: 0,
  INVALID_ENUM: 0x0500,
  INVALID_VALUE: 0x0501,
  INVALID_OPERATION: 0x0502,
  OUT_OF_MEMORY: 0x0505,
  CW: 0x0900,
  CCW: 0x0901,
  LINE_WIDTH: 0x0b21,
  CULL_FACE_MODE: 0x0b45,
  FRONT_FACE: 0x0b46,
  DEPTH_RANGE: 0x0b70,
  DEPTH_WRITEMASK: 0x0b72,
  DEPTH_CLEAR_VALUE: 0x0b73,
  DEPTH_FUNC: 0x0b74,
  STENCIL_CLEAR_VALUE: 0x0b91,
  VIEWPORT: 0x0ba2,
  SCISSOR_BOX: 0x0c10,
  COLOR_CLEAR_VALUE: 0x0c22,
  COLOR_WRITEMASK: 0x0c23,
  UNPACK_ALIGNMENT: 0x0cf5,
  PACK_ALIGNMENT: 0x0d05,
  MAX_TEXTURE_SIZE: 0x0d33,
  MAX_VIEWPORT_DIMS: 0x0d3a,
  SUBPIXEL_BITS: 0x0d50,
  RED_BITS: 0x0d52,
  GREEN_BITS: 0x0d53,
  BLUE_BITS: 0x0d54,
  ALPHA_BITS: 0x0d55,
  DEPTH_BITS: 0x0d56,
  STENCIL_BITS: 0x0d57,
  TEXTURE_BINDING_2D: 0x8069,
  SAMPLE_BUFFERS: 0x80a8,
  SAMPLES: 0x80a9,
  ALIASED_POINT_SIZE_RANGE: 0x846d,
  ALIASED_LINE_WIDTH_RANGE: 0x846e,
  MAX_ELEMENTS_VERTICES: 0x80e8,
  MAX_ELEMENTS_INDICES: 0x80e9,
  MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe,
  DONT_CARE: 0x1100,
  FASTEST: 0x1101,
  NICEST: 0x1102,
  BYTE: 0x1400,
  UNSIGNED_BYTE: 0x1401,
  SHORT: 0x1402,
  UNSIGNED_SHORT: 0x1403,
  INT: 0x1404,
  UNSIGNED_INT: 0x1405,
  FLOAT: 0x1406,
  HALF_FLOAT: 0x140b,
  DEPTH_COMPONENT: 0x1902,
  ALPHA: 0x1906,
  RGB: 0x1907,
  RGBA: 0x1908,
  LUMINANCE: 0x1909,
  LUMINANCE_ALPHA: 0x190a,
  KEEP: 0x1e00,
  REPLACE: 0x1e01,
  INCR: 0x1e02,
  DECR: 0x1e03,
  NEVER: 0x0200,
  LESS: 0x0201,
  EQUAL: 0x0202,
  LEQUAL: 0x0203,
  GREATER: 0x0204,
  NOTEQUAL: 0x0205,
  GEQUAL: 0x0206,
  ALWAYS: 0x0207,
  VENDOR: 0x1f00,
  RENDERER: 0x1f01,
  VERSION: 0x1f02,
  NEAREST: 0x2600,
  LINEAR: 0x2601,
  NEAREST_MIPMAP_NEAREST: 0x2700,
  LINEAR_MIPMAP_NEAREST: 0x2701,
  NEAREST_MIPMAP_LINEAR: 0x2702,
  LINEAR_MIPMAP_LINEAR: 0x2703,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  REPEAT: 0x2901,
  CLAMP_TO_EDGE: 0x812f,
  MIRRORED_REPEAT: 0x8370,
  TEXTURE0: 0x84c0,
  ACTIVE_TEXTURE: 0x84e0,
  TEXTURE_CUBE_MAP: 0x8513,
  TEXTURE_BINDING_CUBE_MAP: 0x8514,
  MAX_CUBE_MAP_TEXTURE_SIZE: 0x851c,
  TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515,
  FRAGMENT_SHADER: 0x8b30,
  VERTEX_SHADER: 0x8b31,
  MAX_VERTEX_ATTRIBS: 0x8869,
  MAX_VERTEX_UNIFORM_VECTORS: 0x8dfb,
  MAX_VARYING_VECTORS: 0x8dfc,
  MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8b4d,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8b4c,
  MAX_TEXTURE_IMAGE_UNITS: 0x8872,
  MAX_FRAGMENT_UNIFORM_VECTORS: 0x8dfd,
  SHADER_TYPE: 0x8b4f,
  DELETE_STATUS: 0x8b80,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  VALIDATE_STATUS: 0x8b83,
  ATTACHED_SHADERS: 0x8b85,
  ACTIVE_UNIFORMS: 0x8b86,
  ACTIVE_ATTRIBUTES: 0x8b89,
  SHADING_LANGUAGE_VERSION: 0x8b8c,
  CURRENT_PROGRAM: 0x8b8d,
  FLOAT_VEC2: 0x8b50,
  FLOAT_VEC3: 0x8b51,
  FLOAT_VEC4: 0x8b52,
  INT_VEC2: 0x8b53,
  INT_VEC3: 0x8b54,
  INT_VEC4: 0x8b55,
  BOOL: 0x8b56,
  BOOL_VEC2: 0x8b57,
  BOOL_VEC3: 0x8b58,
  BOOL_VEC4: 0x8b59,
  FLOAT_MAT2: 0x8b5a,
  FLOAT_MAT3: 0x8b5b,
  FLOAT_MAT4: 0x8b5c,
  SAMPLER_2D: 0x8b5e,
  SAMPLER_CUBE: 0x8b60,
  SAMPLER_3D: 0x8b5f,
  VERTEX_ATTRIB_ARRAY_ENABLED: 0x8622,
  VERTEX_ATTRIB_ARRAY_SIZE: 0x8623,
  VERTEX_ATTRIB_ARRAY_STRIDE: 0x8624,
  VERTEX_ATTRIB_ARRAY_TYPE: 0x8625,
  VERTEX_ATTRIB_ARRAY_NORMALIZED: 0x886a,
  VERTEX_ATTRIB_ARRAY_POINTER: 0x8645,
  VERTEX_ATTRIB_ARRAY_BUFFER_BINDING: 0x889f,
  IMPLEMENTATION_COLOR_READ_TYPE: 0x8b9a,
  IMPLEMENTATION_COLOR_READ_FORMAT: 0x8b9b,
  LOW_FLOAT: 0x8df0,
  MEDIUM_FLOAT: 0x8df1,
  HIGH_FLOAT: 0x8df2,
  LOW_INT: 0x8df3,
  MEDIUM_INT: 0x8df4,
  HIGH_INT: 0x8df5,
  FRAMEBUFFER: 0x8d40,
  RENDERBUFFER: 0x8d41,
  RGBA4: 0x8056,
  RGB5_A1: 0x8057,
  RGB565: 0x8d62,
  DEPTH_COMPONENT16: 0x81a5,
  STENCIL_INDEX8: 0x8d48,
  RENDERBUFFER_WIDTH: 0x8d42,
  RENDERBUFFER_HEIGHT: 0x8d43,
  COLOR_ATTACHMENT0: 0x8ce0,
  DEPTH_ATTACHMENT: 0x8d00,
  STENCIL_ATTACHMENT: 0x8d20,
  DEPTH_STENCIL_ATTACHMENT: 0x821a,
  NONE: 0,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  FRAMEBUFFER_INCOMPLETE_ATTACHMENT: 0x8cd6,
  FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: 0x8cd7,
  FRAMEBUFFER_UNSUPPORTED: 0x8cdd,
  FRAMEBUFFER_BINDING: 0x8ca6,
  DRAW_FRAMEBUFFER_BINDING: 0x8ca6,
  RENDERBUFFER_BINDING: 0x8ca7,
  MAX_RENDERBUFFER_SIZE: 0x84e8,
  INVALID_FRAMEBUFFER_OPERATION: 0x0506,
  UNPACK_FLIP_Y_WEBGL: 0x9240,
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
  CONTEXT_LOST_WEBGL: 0x9242,
  UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243,
  BROWSER_DEFAULT_WEBGL: 0x9244,
  UNMASKED_VENDOR_WEBGL: 0x9245,
  UNMASKED_RENDERER_WEBGL: 0x9246,
  READ_BUFFER: 0x0c02,
  UNPACK_ROW_LENGTH: 0x0cf2,
  UNPACK_SKIP_ROWS: 0x0cf3,
  UNPACK_SKIP_PIXELS: 0x0cf4,
  PACK_ROW_LENGTH: 0x0d02,
  MAX_DRAW_BUFFERS: 0x8824,
  DRAW_BUFFER0: 0x8825,
  MAX_COLOR_ATTACHMENTS: 0x8cdf,
  MAX_SAMPLES: 0x8d57,
  RGB8: 0x8051,
  RGBA8: 0x8058,
  DEPTH_COMPONENT24: 0x81a6,
  DEPTH_COMPONENT32F: 0x8cac,
  DEPTH24_STENCIL8: 0x88f0,
  DEPTH32F_STENCIL8: 0x8cad,
  VERTEX_ATTRIB_ARRAY_DIVISOR: 0x88fe,
  VERTEX_ARRAY_BINDING: 0x85b5,
  DRAW_FRAMEBUFFER: 0x8ca9,
  READ_FRAMEBUFFER: 0x8ca8,
  READ_FRAMEBUFFER_BINDING: 0x8caa,
  UNIFORM_BUFFER: 0x8a11,
  COPY_READ_BUFFER: 0x8f36,
  COPY_WRITE_BUFFER: 0x8f37,
  PIXEL_PACK_BUFFER: 0x88eb,
  PIXEL_UNPACK_BUFFER: 0x88ec,
  TRANSFORM_FEEDBACK_BUFFER: 0x8c8e,
  RASTERIZER_DISCARD: 0x8c89,
  SRGB8_ALPHA8: 0x8c43,
  RGBA32F: 0x8814,
  RGBA16F: 0x881a,
  TEXTURE_3D: 0x806f,
  TEXTURE_2D_ARRAY: 0x8c1a,
  TEXTURE_WRAP_R: 0x8072,
  COMPARE_REF_TO_TEXTURE: 0x884e,
  TEXTURE_COMPARE_MODE: 0x884c,
  TEXTURE_COMPARE_FUNC: 0x884d,
  TEXTURE_BASE_LEVEL: 0x813c,
  TEXTURE_MAX_LEVEL: 0x813d,
  TEXTURE_MAX_LOD: 0x813b,
  TEXTURE_MIN_LOD: 0x813a,
  MAX_3D_TEXTURE_SIZE: 0x8073,
  MAX_ARRAY_TEXTURE_LAYERS: 0x88ff,
  MAX_VERTEX_UNIFORM_COMPONENTS: 0x8b4a,
  MAX_FRAGMENT_UNIFORM_COMPONENTS: 0x8b49,
  MAX_ELEMENT_INDEX: 0x8d6b,
  RED: 0x1903,
  RG: 0x8227,
  R8: 0x8229,
  RG8: 0x822b,
  R16F: 0x822d,
  RG16F: 0x822f,
  RGBA32UI: 0x8d70,
  MIN: 0x8007,
  MAX: 0x8008,
}

const TYPE_SIZE = new Map([
  ['float', 1],
  ['vec2', 2],
  ['vec3', 3],
  ['vec4', 4],
  ['mat2', 4],
  ['mat3', 9],
  ['mat4', 16],
  ['int', 1],
  ['bool', 1],
  ['sampler2D', 1],
  ['samplerCube', 1],
  ['sampler3D', 1],
])

const GL_TYPE = {
  float: GL.FLOAT,
  vec2: GL.FLOAT_VEC2,
  vec3: GL.FLOAT_VEC3,
  vec4: GL.FLOAT_VEC4,
  int: GL.INT,
  bool: GL.BOOL,
  mat2: GL.FLOAT_MAT2,
  mat3: GL.FLOAT_MAT3,
  mat4: GL.FLOAT_MAT4,
  sampler2D: GL.SAMPLER_2D,
  samplerCube: GL.SAMPLER_CUBE,
  sampler3D: GL.SAMPLER_3D,
}

const LOC_SIZE = { mat2: 2, mat3: 3, mat4: 4 }


function parseProgram(vertexSrc, fragmentSrc) {
  return parseShaderProgram(vertexSrc, fragmentSrc)
}

function copyBytes(data) {
  if (typeof data === 'number') return new Uint8Array(Math.max(0, data))
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
  if (data instanceof ArrayBuffer) return new Uint8Array(data).slice()
  return new Uint8Array()
}

function halfToFloat(h) {
  const s = (h & 0x8000) >> 15
  const e = (h & 0x7c00) >> 10
  const f = h & 0x03ff
  if (e === 0) return (s ? -1 : 1) * 2 ** -14 * (f / 1024)
  if (e === 31) return f ? NaN : s ? -Infinity : Infinity
  return (s ? -1 : 1) * 2 ** (e - 15) * (1 + f / 1024)
}

function readComponent(data, byteOffset, type, normalized) {
  if (byteOffset < 0 || byteOffset >= data.byteLength) return 0
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (type === GL.FLOAT) return view.getFloat32(byteOffset, true)
  if (type === GL.HALF_FLOAT) return halfToFloat(view.getUint16(byteOffset, true))
  if (type === GL.UNSIGNED_BYTE) {
    const v = view.getUint8(byteOffset)
    return normalized ? v / 255 : v
  }
  if (type === GL.BYTE) {
    const v = view.getInt8(byteOffset)
    return normalized ? Math.max(v / 127, -1) : v
  }
  if (type === GL.UNSIGNED_SHORT) {
    const v = view.getUint16(byteOffset, true)
    return normalized ? v / 65535 : v
  }
  if (type === GL.SHORT) {
    const v = view.getInt16(byteOffset, true)
    return normalized ? Math.max(v / 32767, -1) : v
  }
  if (type === GL.UNSIGNED_INT) return view.getUint32(byteOffset, true)
  if (type === GL.INT) return view.getInt32(byteOffset, true)
  return 0
}


function readIndex(buffer, type, byteOffset) {
  if (!buffer) return 0
  return readComponent(buffer.data, byteOffset, type, false)
}

function indexStride(type) {
  if (type === GL.UNSIGNED_INT) return 4
  if (type === GL.UNSIGNED_SHORT) return 2
  return 1
}


function toRGBA(src, width, height) {
  const out = new Uint8ClampedArray(width * height * 4)
  const n = width * height
  if (!src) return out
  if (src.length >= n * 4) {
    for (let i = 0; i < out.length; i++) out[i] = src[i] ?? 0
    return out
  }
  if (src.length >= n * 3) {
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      out[j] = src[i * 3] ?? 0
      out[j + 1] = src[i * 3 + 1] ?? 0
      out[j + 2] = src[i * 3 + 2] ?? 0
      out[j + 3] = 255
    }
  }
  return out
}

function readImageSource(source) {
  if (!source) return null
  const width = source.width | 0
  const height = source.height | 0
  if (width <= 0 || height <= 0) return null
  if (source.data && typeof source.data.length === 'number') return { width, height, data: toRGBA(source.data, width, height) }
  if (typeof source.getContext === 'function') {
    try {
      const ctx = source.getContext('2d')
      const image = ctx?.getImageData?.(0, 0, width, height)
      if (image && image.data.length >= width * height * 4) return { width, height, data: new Uint8ClampedArray(image.data) }
    } catch {
      return null
    }
  }
  return null
}

function makeBuffer(width, height, samples = 1) {
  const w = Math.max(1, width | 0)
  const h = Math.max(1, height | 0)
  const scale = samples === MESH_SAMPLES ? MESH_SAMPLES : 1
  const rasterW = w * scale
  const rasterH = h * scale
  return {
    width: w,
    height: h,
    samples: scale,
    rasterW,
    rasterH,
    seeded: false,
    color: new Uint8ClampedArray(rasterW * rasterH * 4),
    depth: new Float32Array(rasterW * rasterH).fill(1),
  }
}

function emptySlot() {
  return { enabled: false, divisor: 0, size: 4, type: GL.FLOAT, normalized: false, stride: 0, offset: 0, buffer: null, value: [0, 0, 0, 1] }
}

export function createFakeWebGL(host, attributes = {}) {
  const ctx = host.ctx
  let screen = makeBuffer(host.canvas.width, host.canvas.height, MESH_SAMPLES)
  const textures = new Map()
  let textureUnit = 0
  const textureBinding = []
  let arrayBuffer = null
  let drawFramebuffer = null
  let readFramebuffer = null
  let renderbuffer = null
  let program = null
  const defaultVao = { attribs: [], elementBuffer: null, isVAO: true }
  let vao = defaultVao
  const enabled = new Set()
  let frontFace = GL.CCW
  let cullFace = GL.BACK
  let depthFunc = GL.LESS
  let depthMask = true
  const colorMask = [true, true, true, true]
  let lineWidth = 1
  const clearColor = [0, 0, 0, 0]
  let clearDepth = 1
  let blendSrc = GL.ONE
  let blendDst = GL.ZERO
  let unpackFlipY = false
  let unpackPremultiply = false
  let unpackAlignment = 4
  let unpackColorspace = GL.BROWSER_DEFAULT_WEBGL
  let viewport = { x: 0, y: 0, w: screen.width, h: screen.height }
  let scissor = { x: 0, y: 0, w: screen.width, h: screen.height }
  const framebuffers = new Map()

  const queue = []
  let flushing = false

  function flushCommands() {
    if (flushing) return
    flushing = true
    try {
      const batch = queue.splice(0, queue.length)
      const dirty = new Set()
      for (const cmd of batch) {
        cmd.run()
        dirty.add(cmd.buf)
      }
      for (const buf of dirty) present(buf)
    } finally {
      flushing = false
    }
  }

  if (!host.ctx.__flexlayerWebgl) {
    const readCanvas = host.ctx.getImageData.bind(host.ctx)
    host.ctx.__flexlayerWebgl = true
    host.ctx.getImageData = (...args) => {
      if (!flushing) flushCommands()
      return readCanvas(...args)
    }
  }

  function resize() {
    queue.length = 0
    screen = makeBuffer(host.canvas.width, host.canvas.height, MESH_SAMPLES)
    viewport = { x: 0, y: 0, w: screen.width, h: screen.height }
    scissor = { x: 0, y: 0, w: screen.width, h: screen.height }
    present(screen)
  }
  host.onBitmapResize = resize

  function targetOf(fb) {
    if (!fb) return screen
    let buf = framebuffers.get(fb)
    if (!buf) {
      buf = makeBuffer(fb.width || screen.width, fb.height || screen.height)
      framebuffers.set(fb, buf)
    }
    return buf
  }

  function pull(buf) {
    if (buf !== screen || buf.seeded) return
    if (buf.width !== host.canvas.width || buf.height !== host.canvas.height) return
    const image = ctx.getImageData(0, 0, buf.width, buf.height)
    const scale = buf.samples
    if (scale === 1) buf.color.set(image.data)
    else {
      const w = buf.width
      const rw = buf.rasterW
      for (let y = 0; y < buf.height; y++) {
        for (let x = 0; x < w; x++) {
          const si = (y * w + x) * 4
          for (let oy = 0; oy < scale; oy++) {
            for (let ox = 0; ox < scale; ox++) {
              const di = ((y * scale + oy) * rw + (x * scale + ox)) * 4
              buf.color[di] = image.data[si]
              buf.color[di + 1] = image.data[si + 1]
              buf.color[di + 2] = image.data[si + 2]
              buf.color[di + 3] = image.data[si + 3]
            }
          }
        }
      }
    }
    buf.seeded = true
  }

  function present(buf) {
    if (buf !== screen) return
    const image = ctx.createImageData(buf.width, buf.height)
    if (!resolveGrid(buf.color, buf.rasterW, buf.width, buf.height, buf.samples, image.data)) {
      image.data.set(buf.color.subarray(0, buf.width * buf.height * 4))
    }
    ctx.putImageData(image, 0, 0)
    buf.seeded = true
  }

  function slot(index) {
    const i = index | 0
    if (!vao.attribs[i]) vao.attribs[i] = emptySlot()
    return vao.attribs[i]
  }

  function setConst(index, values) {
    const item = slot(index)
    item.value[0] = values[0] ?? 0
    item.value[1] = values[1] ?? 0
    item.value[2] = values[2] ?? 0
    item.value[3] = values.length > 3 ? values[3] : 1
  }

  function bindTexture(target, texture) {
    textureBinding[textureUnit] = textureBinding[textureUnit] ?? {}
    textureBinding[textureUnit][target] = texture
    if (texture) texture.target = target
  }

  function currentTexture() {
    return textureBinding[textureUnit]?.[GL.TEXTURE_2D] ?? null
  }

  function storeImage(tex, width, height, data, flipY) {
    tex.width = width
    tex.height = height
    tex.data = data
    tex.flipY = flipY
    if (!tex.wrapS) tex.wrapS = GL.CLAMP_TO_EDGE
    if (!tex.wrapT) tex.wrapT = GL.CLAMP_TO_EDGE
  }

  function uniformData(name) {
    return program?.values?.get(name) ?? null
  }

  function uniformVec(name, count, fallback) {
    const data = uniformData(name)
    if (!data) return fallback
    const out = fallback.slice()
    for (let i = 0; i < count; i++) out[i] = data[i] ?? out[i]
    return out
  }

  function uniformNum(name, fallback) {
    const data = uniformData(name)
    if (!data) return fallback
    return data[0] ?? fallback
  }


  function packAttrib(item) {
    const slotItem = item || emptySlot()
    const value = slotItem.value || [0, 0, 0, 1]
    const data = slotItem.buffer && slotItem.buffer.data ? copyBytes(slotItem.buffer.data) : new Uint8Array()
    return {
      data,
      hasBuffer: Boolean(slotItem.enabled && slotItem.buffer),
      size: slotItem.size || 4,
      glType: slotItem.type,
      normalized: Boolean(slotItem.normalized),
      stride: slotItem.stride || 0,
      offset: slotItem.offset || 0,
      v0: value[0] ?? 0,
      v1: value[1] ?? 0,
      v2: value[2] ?? 0,
      v3: value[3] ?? 1,
    }
  }

  const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const BUILTIN_SHADERS = new Set([
    'MeshBasicMaterial',
    'MeshLambertMaterial',
    'MeshPhongMaterial',
    'MeshStandardMaterial',
    'MeshPhysicalMaterial',
    'MeshToonMaterial',
    'MeshMatcapMaterial',
  ])

  const THREE_BUILTIN_SINCE = 160

  function shaderKindOf(vertex, fragment) {
    const src = `${vertex}\n${fragment}`
    const type = src.match(/#define\s+SHADER_TYPE\s+(\w+)/)?.[1] ?? ''
    const uses = [...src.matchAll(/#define\s+(USE_[A-Z0-9_]+)/g)].map((match) => match[1])
    const revMatch = src.match(/three\.js r(\d+)/i) ?? src.match(/#define\s+THREE_REVISION\s+(\d+)/)
    const revision = revMatch ? Number(revMatch[1]) : null
    const inRange = revision == null || revision >= THREE_BUILTIN_SINCE
    return { type, uses, revision, builtin: BUILTIN_SHADERS.has(type) && inRange }
  }

  function componentBytes(type) {
    if (type === GL.BYTE || type === GL.UNSIGNED_BYTE) return 1
    if (type === GL.SHORT || type === GL.UNSIGNED_SHORT || type === GL.HALF_FLOAT) return 2
    return 4
  }

  function halfToFloat(bits) {
    const sign = (bits & 0x8000) << 16
    const exp = (bits >> 10) & 0x1f
    const frac = bits & 0x3ff
    let out = sign
    if (exp === 0) {
      if (frac !== 0) {
        let e = -1
        let m = frac
        do {
          e++
          m <<= 1
        } while ((m & 0x400) === 0)
        m &= 0x3ff
        out |= ((127 - 15 - e) << 23) | (m << 13)
      }
    } else if (exp === 31) {
      out |= 0x7f800000 | (frac << 13)
    } else {
      out |= ((exp + (127 - 15)) << 23) | (frac << 13)
    }
    return new Float32Array(new Uint32Array([out]).buffer)[0]
  }

  function readComponent(view, offset, type, normalized, byteLength) {
    if (offset < 0 || offset >= byteLength) return 0
    if (type === GL.FLOAT) {
      if (offset + 4 > byteLength) return 0
      return view.getFloat32(offset, true)
    }
    if (type === GL.HALF_FLOAT) {
      if (offset + 2 > byteLength) return 0
      return halfToFloat(view.getUint16(offset, true))
    }
    if (type === GL.UNSIGNED_BYTE) {
      const v = view.getUint8(offset)
      return normalized ? v / 255 : v
    }
    if (type === GL.BYTE) {
      const v = view.getInt8(offset)
      return normalized ? Math.max(v / 127, -1) : v
    }
    if (type === GL.UNSIGNED_SHORT) {
      if (offset + 2 > byteLength) return 0
      const v = view.getUint16(offset, true)
      return normalized ? v / 65535 : v
    }
    if (type === GL.SHORT) {
      if (offset + 2 > byteLength) return 0
      const v = view.getInt16(offset, true)
      return normalized ? Math.max(v / 32767, -1) : v
    }
    if (type === GL.UNSIGNED_INT) {
      if (offset + 4 > byteLength) return 0
      const v = view.getUint32(offset, true)
      return normalized ? v / 4294967295 : v
    }
    if (type === GL.INT) {
      if (offset + 4 > byteLength) return 0
      return view.getInt32(offset, true)
    }
    return 0
  }

  function readPosition(index) {
    const posLoc = program?.attributeByName?.get('position')?.location ?? 0
    const item = slot(posLoc)
    if (!item.enabled || !item.buffer?.data) return [item.value[0] ?? 0, item.value[1] ?? 0, item.value[2] ?? 0]
    const size = item.size || 3
    const stride = item.stride || size * componentBytes(item.type ?? GL.FLOAT)
    const offset = (item.offset | 0) + index * stride
    const bytes = item.buffer.data
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const out = [0, 0, 0, 1]
    const step = componentBytes(item.type ?? GL.FLOAT)
    for (let k = 0; k < size && k < 4; k++) {
      out[k] = readComponent(view, offset + k * step, item.type ?? GL.FLOAT, Boolean(item.normalized), bytes.byteLength)
    }
    return out
  }

  function positionSamples(count, indexOf) {
    const samples = []
    for (let i = 0; i < count; i++) samples.push(readPosition(indexOf(i)))
    return samples
  }

  function looksLikeClip(samples) {
    return samples.length > 0 && samples.every((p) => Math.abs(p[0]) <= 1.25 && Math.abs(p[1]) <= 1.25 && Math.abs(p[2]) <= 1.25)
  }

  function missesCanvas(samples) {
    const w = host.canvas.width
    const h = host.canvas.height
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of samples) {
      minX = Math.min(minX, p[0])
      maxX = Math.max(maxX, p[0])
      minY = Math.min(minY, p[1])
      maxY = Math.max(maxY, p[1])
    }
    return maxX < 0 || maxY < 0 || minX > w || minY > h
  }

  function reportUncovered() {
    host.report?.({
      level: 'warn',
      code: 'unsupported-webgl',
      message: 'WebGL 绘制没有落在画布上',
      hint: '没有矩阵时，坐标在 -1 到 1 会按裁剪空间投影。像素坐标要落在画布里',
    })
  }

  function paintResolved(buf, pixels) {
    const scale = buf.samples
    const w = buf.width
    const h = buf.height
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = (y * w + x) * 4
        for (let oy = 0; oy < scale; oy++) {
          for (let ox = 0; ox < scale; ox++) {
            const di = ((y * scale + oy) * buf.rasterW + (x * scale + ox)) * 4
            buf.color[di] = pixels[si] ?? 0
            buf.color[di + 1] = pixels[si + 1] ?? 0
            buf.color[di + 2] = pixels[si + 2] ?? 0
            buf.color[di + 3] = pixels[si + 3] ?? 0
          }
        }
      }
    }
    buf.seeded = true
  }

  function enqueue(buf, run) {
    queue.push({ buf, run })
  }

  function draw(mode, count, indexOf) {
    if (count <= 0) return
    const buf = targetOf(drawFramebuffer)
    const kind = program?.shaderKind
    if (kind?.type && kind.revision != null && kind.revision < THREE_BUILTIN_SINCE && BUILTIN_SHADERS.has(kind.type)) {
      host.report?.({
        level: 'warn',
        code: 'unsupported-webgl',
        message: `three.js r${kind.revision} 的 ${kind.type} 不在 0.160 起的内置表里`,
        hint: '升级 three.js，或改用自定义片元着色器',
      })
    }
    const mv = uniformData('modelViewMatrix')
    const proj = uniformData('projectionMatrix')
    const normalMat = uniformData('normalMatrix')
    const clip = mv && proj && mv.length >= 16 && proj.length >= 16
    const diffuse = uniformVec('diffuse', 3, [1, 1, 1])
    const opacity = uniformNum('opacity', 1)
    const emissive = uniformVec('emissive', 3, [0, 0, 0])
    const metalness = uniformNum('metalness', 0)
    const hasRough = uniformData('roughness') != null
    const hasMetal = uniformData('metalness') != null
    const hasShine = uniformData('shininess') != null
    const transmission = uniformNum('transmission', 0)
    const ids = new Uint32Array(count)
    for (let i = 0; i < count; i++) ids[i] = indexOf(i) >>> 0
    const samples = positionSamples(count, indexOf)
    const ndc = !clip && drawFramebuffer == null && looksLikeClip(samples)
    if (!clip && drawFramebuffer == null && !ndc && missesCanvas(samples)) reportUncovered()
    const fragment = program?.shaders?.find((shader) => shader?.type === GL.FRAGMENT_SHADER)?.source ?? ''
    if (ndc && fragment && !program?.shaderKind?.builtin && /gl_FragColor|fragColor/.test(fragment)) {
      const clipBuf = new Float32Array(samples.length * 4)
      samples.forEach((p, i) => {
        clipBuf[i * 4] = p[0]
        clipBuf[i * 4 + 1] = p[1]
        clipBuf[i * 4 + 2] = p[2]
        clipBuf[i * 4 + 3] = 1
      })
      const order = new Uint32Array(samples.length)
      for (let i = 0; i < samples.length; i++) order[i] = i
      const drawCall = {
        width: buf.width,
        height: buf.height,
        clip: clipBuf,
        indices: order,
        colorR: 255,
        colorG: 255,
        colorB: 255,
        colorA: 255,
        shaded: false,
        shader: fragment,
      }
      enqueue(buf, () => {
        pull(buf)
        const frame = webglDraw(drawCall)
        if (frame.reason) {
          host.report?.({
            level: 'warn',
            code: 'unsupported-webgl',
            message: String(frame.reason),
            hint: '换一段这个执行器能跑的片元，或改用内置材质',
          })
        }
        if (!frame.covered) reportUncovered()
        else paintResolved(buf, frame.pixels)
      })
      return
    }
    const posLoc = program?.attributeByName?.get('position')?.location ?? 0
    const nrm = program?.attributeByName?.get('normal')
    const uv = program?.attributeByName?.get('uv')
    const colAttr = program?.attributeByName?.get('color')
    const flat = (slot(1).value || [0, 0, 0, 1]).slice()
    const mapUnit = uniformData('map')
    const tex = mapUnit ? textureBinding[mapUnit[0] | 0]?.[GL.TEXTURE_2D] : null
    const mapBytes = !tex?.data ? new Uint8Array() : ArrayBuffer.isView(tex.data) ? new Uint8Array(tex.data.buffer, tex.data.byteOffset, tex.data.byteLength) : Uint8Array.from(tex.data)
    const constAttrib = (v0, v1, v2, v3) => ({ data: new Uint8Array(), hasBuffer: false, size: 4, glType: GL.FLOAT, normalized: false, stride: 0, offset: 0, v0, v1, v2, v3 })
    const drawCall = {
      mode,
      indices: ids,
      pos: packAttrib(slot(posLoc)),
      nrm: nrm ? packAttrib(slot(nrm.location)) : constAttrib(0, 0, 1, 1),
      uv: uv ? packAttrib(slot(uv.location)) : constAttrib(0, 0, 0, 1),
      col: colAttr ? packAttrib(slot(colAttr.location)) : constAttrib(1, 1, 1, 1),
      hasNormal: Boolean(nrm),
      hasColor: Boolean(colAttr),
      flat0: flat[0] ?? 0,
      flat1: flat[1] ?? 0,
      flat2: flat[2] ?? 0,
      flat3: flat[3] ?? 1,
      mv: clip ? Array.from(mv) : ndc ? IDENTITY4 : [],
      proj: clip ? Array.from(proj) : ndc ? IDENTITY4.slice() : [],
      normalMat: normalMat && normalMat.length >= 9 ? Array.from(normalMat) : [],
      diffuse0: diffuse[0],
      diffuse1: diffuse[1],
      diffuse2: diffuse[2],
      opacity,
      emissive0: emissive[0],
      emissive1: emissive[1],
      emissive2: emissive[2],
      metalness,
      roughness: hasRough ? uniformNum('roughness', 0.65) : 0.65,
      shininess: hasShine ? uniformNum('shininess', 30) : 30,
      transmission,
      hasRough,
      hasMetal,
      hasShine,
      hasMap: mapBytes.length > 0,
      mapW: tex?.width | 0,
      mapH: tex?.height | 0,
      mapFlipY: Boolean(tex?.flipY),
      mapWrapS: tex?.wrapS ?? 0,
      mapWrapT: tex?.wrapT ?? 0,
      mapData: mapBytes,
      rasterW: buf.rasterW,
      rasterH: buf.rasterH,
      samples: buf.samples,
      bufW: buf.width,
      bufH: buf.height,
      viewX: viewport.x,
      viewY: viewport.y,
      viewW: viewport.w,
      viewH: viewport.h,
      scissor: enabled.has(GL.SCISSOR_TEST),
      scissorX: scissor.x,
      scissorY: scissor.y,
      scissorW: scissor.w,
      scissorH: scissor.h,
      depthTest: enabled.has(GL.DEPTH_TEST),
      depthFunc,
      depthMask,
      maskR: colorMask[0],
      maskG: colorMask[1],
      maskB: colorMask[2],
      maskA: colorMask[3],
      blend: enabled.has(GL.BLEND),
      cull: enabled.has(GL.CULL_FACE),
      cullFace,
      frontFace,
      pointSize: Math.max(1, uniformNum('size', 1)),
    }
    enqueue(buf, () => {
      pull(buf)
      fakeDraw(buf.color, buf.depth, drawCall)
    })
  }


  function clearBuffer(buf, mask) {
    const drawCall = {
      mask,
      rasterW: buf.rasterW,
      rasterH: buf.rasterH,
      samples: buf.samples,
      width: buf.width,
      height: buf.height,
      scissor: enabled.has(GL.SCISSOR_TEST),
      scissorX: scissor.x,
      scissorY: scissor.y,
      scissorW: scissor.w,
      scissorH: scissor.h,
      maskR: colorMask[0],
      maskG: colorMask[1],
      maskB: colorMask[2],
      maskA: colorMask[3],
      clearR: clearColor[0],
      clearG: clearColor[1],
      clearB: clearColor[2],
      clearA: clearColor[3],
      clearDepth,
    }
    enqueue(buf, () => {
      pull(buf)
      fakeClear(buf.color, buf.depth, drawCall)
    })
  }

  function drawInstanced(primcount, emit) {
    const n = primcount | 0
    if (n <= 0) return
    const instanced = vao.attribs.some((item) => item && item.divisor > 0)
    if (!instanced || n === 1) {
      emit()
      return
    }
    const saved = vao.attribs.map((item) => item?.offset ?? 0)
    for (let i = 0; i < n; i++) {
      vao.attribs.forEach((item, index) => {
        if (!item || !(item.divisor > 0)) return
        const stride = item.stride || (item.size || 1) * 4
        item.offset = saved[index] + i * item.divisor * stride
      })
      emit()
    }
    vao.attribs.forEach((item, index) => {
      if (item) item.offset = saved[index]
    })
  }

  const api = {
    ...GL,
    canvas: host.element,
    get drawingBufferWidth() {
      return host.canvas.width
    },
    get drawingBufferHeight() {
      return host.canvas.height
    },
    getContextAttributes() {
      return {
        alpha: attributes.alpha !== false,
        depth: attributes.depth !== false,
        stencil: Boolean(attributes.stencil),
        antialias: Boolean(attributes.antialias),
        premultipliedAlpha: attributes.premultipliedAlpha !== false,
        preserveDrawingBuffer: Boolean(attributes.preserveDrawingBuffer),
        powerPreference: attributes.powerPreference ?? 'default',
        failIfMajorPerformanceCaveat: Boolean(attributes.failIfMajorPerformanceCaveat),
      }
    },
    isContextLost: () => false,
    getError: () => GL.NO_ERROR,
    getSupportedExtensions: () => [
      'ANGLE_instanced_arrays',
      'OES_element_index_uint',
      'OES_standard_derivatives',
      'OES_texture_float',
      'OES_texture_half_float',
      'WEBGL_depth_texture',
      'WEBGL_draw_buffers',
      'EXT_color_buffer_float',
    ],
    getExtension(name) {
      if (name === 'ANGLE_instanced_arrays') {
        return {
          VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE: GL.VERTEX_ATTRIB_ARRAY_DIVISOR,
          drawArraysInstancedANGLE: (mode, first, count, primcount) => api.drawArraysInstanced(mode, first, count, primcount),
          drawElementsInstancedANGLE: (mode, count, type, offset, primcount) => api.drawElementsInstanced(mode, count, type, offset, primcount),
          vertexAttribDivisorANGLE: (index, divisor) => api.vertexAttribDivisor(index, divisor),
        }
      }
      if (name === 'OES_standard_derivatives') return { FRAGMENT_SHADER_DERIVATIVE_HINT_OES: 0x8b8b }
      if (name === 'OES_texture_half_float') return { HALF_FLOAT_OES: 0x8d61 }
      if (name === 'WEBGL_draw_buffers') return { drawBuffersWEBGL() {}, COLOR_ATTACHMENT0_WEBGL: GL.COLOR_ATTACHMENT0, DRAW_BUFFER0_WEBGL: GL.DRAW_BUFFER0 }
      if (
        name === 'OES_element_index_uint' ||
        name === 'OES_texture_float' ||
        name === 'WEBGL_depth_texture' ||
        name === 'EXT_color_buffer_float'
      ) {
        return {}
      }
      return null
    },
    getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
    getParameter(pname) {
      switch (pname) {
        case GL.VERSION:
          return 'WebGL 2.0 (Flex Layer)'
        case GL.SHADING_LANGUAGE_VERSION:
          return 'WebGL GLSL ES 3.00 (Flex Layer)'
        case GL.VENDOR:
        case GL.UNMASKED_VENDOR_WEBGL:
          return 'Flex Layer'
        case GL.RENDERER:
        case GL.UNMASKED_RENDERER_WEBGL:
          return 'Flex Layer'
        case GL.MAX_TEXTURE_SIZE:
        case GL.MAX_CUBE_MAP_TEXTURE_SIZE:
        case GL.MAX_RENDERBUFFER_SIZE:
        case GL.MAX_3D_TEXTURE_SIZE:
          return 4096
        case GL.MAX_VERTEX_ATTRIBS:
          return 16
        case GL.MAX_VERTEX_UNIFORM_VECTORS:
        case GL.MAX_FRAGMENT_UNIFORM_VECTORS:
          return 256
        case GL.MAX_VARYING_VECTORS:
          return 16
        case GL.MAX_TEXTURE_IMAGE_UNITS:
        case GL.MAX_VERTEX_TEXTURE_IMAGE_UNITS:
          return 16
        case GL.MAX_COMBINED_TEXTURE_IMAGE_UNITS:
          return 32
        case GL.MAX_SAMPLES:
        case GL.MAX_DRAW_BUFFERS:
        case GL.MAX_COLOR_ATTACHMENTS:
          return 4
        case GL.MAX_VIEWPORT_DIMS:
          return new Int32Array([4096, 4096])
        case GL.ALIASED_LINE_WIDTH_RANGE:
        case GL.ALIASED_POINT_SIZE_RANGE:
          return new Float32Array([1, 1])
        case GL.VIEWPORT:
          return new Int32Array([viewport.x, viewport.y, viewport.w, viewport.h])
        case GL.SCISSOR_BOX:
          return new Int32Array([scissor.x, scissor.y, scissor.w, scissor.h])
        case GL.COLOR_CLEAR_VALUE:
          return new Float32Array(clearColor)
        case GL.DEPTH_CLEAR_VALUE:
          return clearDepth
        case GL.COLOR_WRITEMASK:
          return colorMask.slice()
        case GL.RED_BITS:
        case GL.GREEN_BITS:
        case GL.BLUE_BITS:
        case GL.ALPHA_BITS:
          return 8
        case GL.DEPTH_BITS:
          return 24
        case GL.STENCIL_BITS:
        case GL.SAMPLES:
        case GL.SAMPLE_BUFFERS:
          return 0
        case GL.SUBPIXEL_BITS:
          return 4
        case GL.IMPLEMENTATION_COLOR_READ_FORMAT:
          return GL.RGBA
        case GL.IMPLEMENTATION_COLOR_READ_TYPE:
          return GL.UNSIGNED_BYTE
        case GL.FRAMEBUFFER_BINDING:
        case GL.DRAW_FRAMEBUFFER:
          return drawFramebuffer
        case GL.READ_FRAMEBUFFER_BINDING:
          return readFramebuffer
        case GL.RENDERBUFFER_BINDING:
          return renderbuffer
        case GL.ARRAY_BUFFER_BINDING:
          return arrayBuffer
        case GL.ELEMENT_ARRAY_BUFFER_BINDING:
          return vao.elementBuffer
        case GL.CURRENT_PROGRAM:
          return program
        case GL.VERTEX_ARRAY_BINDING:
          return vao === defaultVao ? null : vao
        case GL.ACTIVE_TEXTURE:
          return GL.TEXTURE0 + textureUnit
        case GL.UNPACK_FLIP_Y_WEBGL:
          return unpackFlipY
        case GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL:
          return unpackPremultiply
        case GL.UNPACK_ALIGNMENT:
          return unpackAlignment
        case GL.UNPACK_COLORSPACE_CONVERSION_WEBGL:
          return unpackColorspace
        case GL.MAX_TEXTURE_MAX_ANISOTROPY_EXT:
          return 1
        case GL.DRAW_BUFFER0:
          return GL.BACK
        case GL.MAX_ELEMENTS_VERTICES:
        case GL.MAX_ELEMENTS_INDICES:
        case GL.MAX_ELEMENT_INDEX:
          return 16777216
        default:
          return 0
      }
    },
    enable(cap) {
      enabled.add(cap)
    },
    disable(cap) {
      enabled.delete(cap)
    },
    isEnabled: (cap) => enabled.has(cap),
    frontFace(mode) {
      frontFace = mode
    },
    cullFace(mode) {
      cullFace = mode
    },
    depthFunc(func) {
      depthFunc = func
    },
    depthMask(flag) {
      depthMask = Boolean(flag)
    },
    colorMask(r, g, b, a) {
      colorMask[0] = Boolean(r)
      colorMask[1] = Boolean(g)
      colorMask[2] = Boolean(b)
      colorMask[3] = Boolean(a)
    },
    lineWidth(w) {
      lineWidth = w || 1
    },
    polygonOffset() {},
    hint() {},
    sampleCoverage() {},
    stencilFunc() {},
    stencilOp() {},
    stencilMask() {},
    blendFunc(src, dst) {
      blendSrc = src
      blendDst = dst
    },
    blendFuncSeparate(srcRgb) {
      blendSrc = srcRgb
    },
    blendEquation() {},
    blendEquationSeparate() {},
    blendColor() {},
    viewport(x, y, w, h) {
      viewport = { x: x | 0, y: y | 0, w: w | 0, h: h | 0 }
    },
    scissor(x, y, w, h) {
      scissor = { x: x | 0, y: y | 0, w: w | 0, h: h | 0 }
    },
    clearColor(r, g, b, a) {
      clearColor[0] = r
      clearColor[1] = g
      clearColor[2] = b
      clearColor[3] = a
    },
    clearDepth(d) {
      clearDepth = d
    },
    clearStencil() {},
    clear(mask) {
      clearBuffer(targetOf(drawFramebuffer), mask | 0)
    },
    createBuffer: () => ({ data: new Uint8Array() }),
    bindBuffer(target, buffer) {
      if (target === GL.ARRAY_BUFFER) arrayBuffer = buffer
      else if (target === GL.ELEMENT_ARRAY_BUFFER) vao.elementBuffer = buffer
    },
    bufferData(target, data) {
      const buf = target === GL.ELEMENT_ARRAY_BUFFER ? vao.elementBuffer : arrayBuffer
      if (buf) buf.data = copyBytes(data)
    },
    bufferSubData(target, offset, data) {
      const buf = target === GL.ELEMENT_ARRAY_BUFFER ? vao.elementBuffer : arrayBuffer
      if (!buf) return
      const bytes = copyBytes(data)
      const next = new Uint8Array(Math.max(buf.data.length, offset + bytes.length))
      next.set(buf.data)
      next.set(bytes, offset)
      buf.data = next
    },
    deleteBuffer() {},
    isBuffer: (buffer) => Boolean(buffer && buffer.data),
    createVertexArray: () => ({ attribs: [], elementBuffer: null, isVAO: true }),
    bindVertexArray(next) {
      vao = next && next.isVAO ? next : defaultVao
    },
    deleteVertexArray() {},
    isVertexArray: (item) => Boolean(item && item.isVAO),
    enableVertexAttribArray(index) {
      slot(index).enabled = true
    },
    disableVertexAttribArray(index) {
      slot(index).enabled = false
    },
    vertexAttribDivisor(index, divisor) {
      slot(index).divisor = divisor | 0
    },
    vertexAttribPointer(index, size, type, normalized, stride, offset) {
      const item = slot(index)
      item.size = size
      item.type = type
      item.normalized = Boolean(normalized)
      item.stride = stride | 0
      item.offset = offset | 0
      item.buffer = arrayBuffer
    },
    vertexAttribIPointer(index, size, type, stride, offset) {
      api.vertexAttribPointer(index, size, type, false, stride, offset)
    },
    vertexAttrib1f: (i, x) => setConst(i, [x]),
    vertexAttrib2f: (i, x, y) => setConst(i, [x, y]),
    vertexAttrib3f: (i, x, y, z) => setConst(i, [x, y, z]),
    vertexAttrib4f: (i, x, y, z, w) => setConst(i, [x, y, z, w]),
    vertexAttrib1fv: (i, v) => setConst(i, v),
    vertexAttrib2fv: (i, v) => setConst(i, v),
    vertexAttrib3fv: (i, v) => setConst(i, v),
    vertexAttrib4fv: (i, v) => setConst(i, v),
    createTexture: () => ({ width: 0, height: 0, data: null, wrapS: GL.CLAMP_TO_EDGE, wrapT: GL.CLAMP_TO_EDGE, flipY: false }),
    bindTexture,
    deleteTexture() {},
    isTexture: (tex) => Boolean(tex && Object.prototype.hasOwnProperty.call(tex, 'width')),
    activeTexture(unit) {
      textureUnit = Math.max(0, (unit | 0) - GL.TEXTURE0)
    },
    texParameteri(target, pname, param) {
      const tex = textureBinding[textureUnit]?.[target]
      if (!tex) return
      if (pname === GL.TEXTURE_WRAP_S) tex.wrapS = param
      if (pname === GL.TEXTURE_WRAP_T) tex.wrapT = param
    },
    texParameterf(target, pname, param) {
      api.texParameteri(target, pname, param)
    },
    generateMipmap(target) {
      const tex = textureBinding[textureUnit]?.[target]
      if (!tex?.data || !(tex.width > 0) || !(tex.height > 0)) return
      const mips = [tex.data]
      let w = tex.width | 0
      let h = tex.height | 0
      let src = tex.data
      while (w > 1 || h > 1) {
        const nw = Math.max(1, w >> 1)
        const nh = Math.max(1, h >> 1)
        const dst = new Uint8Array(nw * nh * 4)
        for (let y = 0; y < nh; y++) {
          for (let x = 0; x < nw; x++) {
            let r = 0
            let g = 0
            let b = 0
            let a = 0
            let n = 0
            for (let oy = 0; oy < 2; oy++) {
              for (let ox = 0; ox < 2; ox++) {
                const sx = Math.min(w - 1, x * 2 + ox)
                const sy = Math.min(h - 1, y * 2 + oy)
                const i = (sy * w + sx) * 4
                r += src[i] ?? 0
                g += src[i + 1] ?? 0
                b += src[i + 2] ?? 0
                a += src[i + 3] ?? 0
                n++
              }
            }
            const o = (y * nw + x) * 4
            dst[o] = Math.round(r / n)
            dst[o + 1] = Math.round(g / n)
            dst[o + 2] = Math.round(b / n)
            dst[o + 3] = Math.round(a / n)
          }
        }
        mips.push(dst)
        src = dst
        w = nw
        h = nh
      }
      tex.mips = mips
    },
    pixelStorei(pname, param) {
      if (pname === GL.UNPACK_FLIP_Y_WEBGL) unpackFlipY = Boolean(param)
      else if (pname === GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL) unpackPremultiply = Boolean(param)
      else if (pname === GL.UNPACK_ALIGNMENT) unpackAlignment = param | 0
      else if (pname === GL.UNPACK_COLORSPACE_CONVERSION_WEBGL) unpackColorspace = param
    },
    texStorage2D(target, _levels, _internal, width, height) {
      const tex = textureBinding[textureUnit]?.[target] ?? currentTexture()
      if (!tex) return
      storeImage(tex, width | 0, height | 0, new Uint8ClampedArray(Math.max(0, (width | 0) * (height | 0) * 4)), unpackFlipY)
    },
    texStorage3D() {},
    texImage2D(target, _level, _internal, a, b, c, d, e, f) {
      const face = target >= GL.TEXTURE_CUBE_MAP_POSITIVE_X && target < GL.TEXTURE_CUBE_MAP_POSITIVE_X + 6
      const tex = textureBinding[textureUnit]?.[face ? GL.TEXTURE_CUBE_MAP : target]
      if (!tex) return
      const stored = f !== undefined
        ? { width: a | 0, height: b | 0, data: toRGBA(f, a | 0, b | 0) }
        : readImageSource(c)
      if (!stored) return
      if (face) {
        tex.faces = tex.faces ?? {}
        tex.faces[target] = stored
        if (!tex.data) storeImage(tex, stored.width, stored.height, stored.data, unpackFlipY)
        return
      }
      storeImage(tex, stored.width, stored.height, stored.data, unpackFlipY)
    },
    texImage3D() {},
    texSubImage2D(target, _level, _x, _y, a, b, c, d, e) {
      const tex = textureBinding[textureUnit]?.[target]
      if (!tex) return
      if (e !== undefined) storeImage(tex, a | 0, b | 0, toRGBA(e, a | 0, b | 0), unpackFlipY)
      else {
        const image = readImageSource(c)
        if (image) storeImage(tex, image.width, image.height, image.data, unpackFlipY)
      }
    },
    texSubImage3D() {},
    compressedTexImage2D() {},
    compressedTexImage3D() {},
    compressedTexSubImage2D() {},
    compressedTexSubImage3D() {},
    copyTexImage2D() {},
    copyTexSubImage2D() {},
    createFramebuffer: () => ({ width: 0, height: 0, color: null, depth: null }),
    bindFramebuffer(target, fb) {
      if (target === GL.READ_FRAMEBUFFER) readFramebuffer = fb
      else {
        drawFramebuffer = fb
        if (target === GL.FRAMEBUFFER) readFramebuffer = fb
      }
    },
    deleteFramebuffer() {},
    isFramebuffer: (fb) => Boolean(fb && Object.prototype.hasOwnProperty.call(fb, 'color')),
    framebufferTexture2D(_target, attachment, _textarget, texture) {
      if (!drawFramebuffer) return
      if (attachment === GL.COLOR_ATTACHMENT0) drawFramebuffer.color = texture
      if (texture?.width) {
        drawFramebuffer.width = texture.width
        drawFramebuffer.height = texture.height
        framebuffers.set(drawFramebuffer, makeBuffer(texture.width, texture.height))
      }
    },
    framebufferRenderbuffer(_target, attachment, _renderbuffertarget, rb) {
      if (!drawFramebuffer || !rb) return
      if (attachment === GL.DEPTH_ATTACHMENT || attachment === GL.DEPTH_STENCIL_ATTACHMENT) drawFramebuffer.depth = rb
      if (rb.width) {
        drawFramebuffer.width = rb.width
        drawFramebuffer.height = rb.height
        framebuffers.set(drawFramebuffer, makeBuffer(rb.width, rb.height))
      }
    },
    checkFramebufferStatus: () => GL.FRAMEBUFFER_COMPLETE,
    createRenderbuffer: () => ({ width: 0, height: 0 }),
    bindRenderbuffer(_target, rb) {
      renderbuffer = rb
    },
    renderbufferStorage(_target, _format, width, height) {
      if (!renderbuffer) return
      renderbuffer.width = width | 0
      renderbuffer.height = height | 0
    },
    renderbufferStorageMultisample(_target, _samples, format, width, height) {
      api.renderbufferStorage(_target, format, width, height)
    },
    deleteRenderbuffer() {},
    isRenderbuffer: (rb) => Boolean(rb && Object.prototype.hasOwnProperty.call(rb, 'width')),
    drawBuffers() {},
    readBuffer() {},
    blitFramebuffer() {},
    invalidateFramebuffer() {},
    readPixels(x, y, width, height, _format, _type, pixels) {
      flushCommands()
      const buf = targetOf(readFramebuffer ?? drawFramebuffer)
      if (!pixels) return
      const resolved = buf.samples === 1 ? buf.color : (() => {
        const dst = new Uint8ClampedArray(buf.width * buf.height * 4)
        if (!resolveGrid(buf.color, buf.rasterW, buf.width, buf.height, buf.samples, dst)) dst.set(buf.color.subarray(0, dst.length))
        return dst
      })()
      let o = 0
      for (let row = 0; row < height; row++) {
        const srcY = buf.height - 1 - ((y | 0) + row)
        for (let col = 0; col < width; col++) {
          const srcX = (x | 0) + col
          const i = srcY >= 0 && srcX >= 0 && srcY < buf.height && srcX < buf.width ? (srcY * buf.width + srcX) * 4 : -1
          pixels[o++] = i >= 0 ? resolved[i] : 0
          pixels[o++] = i >= 0 ? resolved[i + 1] : 0
          pixels[o++] = i >= 0 ? resolved[i + 2] : 0
          pixels[o++] = i >= 0 ? resolved[i + 3] : 0
        }
      }
    },
    createShader: (type) => ({ type, source: '' }),
    shaderSource(shader, source) {
      if (shader) shader.source = String(source ?? '')
    },
    compileShader() {},
    getShaderParameter: (_shader, pname) => pname !== GL.DELETE_STATUS,
    getShaderInfoLog: () => '',
    deleteShader() {},
    isShader: (shader) => Boolean(shader && Object.prototype.hasOwnProperty.call(shader, 'source')),
    createProgram: () => ({
      shaders: [],
      binds: new Map(),
      attributeList: [],
      attributeByName: new Map(),
      uniformList: [],
      uniformByName: new Map(),
      values: new Map(),
    }),
    attachShader(prog, shader) {
      prog?.shaders.push(shader)
    },
    detachShader() {},
    bindAttribLocation(prog, index, name) {
      prog?.binds.set(name, index | 0)
    },
    linkProgram(prog) {
      if (!prog) return
      const vertex = prog.shaders.find((shader) => shader?.type === GL.VERTEX_SHADER)?.source ?? ''
      const fragment = prog.shaders.find((shader) => shader?.type === GL.FRAGMENT_SHADER)?.source ?? ''
      const parsed = parseProgram(vertex, fragment)
      prog.shaderKind = shaderKindOf(vertex, fragment)
      let next = 0
      const used = new Set()
      for (const [name, index] of prog.binds) {
        used.add(index)
        next = Math.max(next, index + (LOC_SIZE[parsed.attributes.find((attr) => attr.name === name)?.glsl] ?? 1))
      }
      prog.attributeList = []
      prog.attributeByName = new Map()
      for (const attr of parsed.attributes) {
        let location = prog.binds.get(attr.name)
        const span = LOC_SIZE[attr.glsl] ?? 1
        if (location == null) {
          while ([...Array(span).keys()].some((offset) => used.has(next + offset))) next++
          location = next
          next += span
        }
        for (let i = 0; i < span; i++) used.add(location + i)
        const info = { name: attr.name, type: GL_TYPE[attr.glsl], location, size: 1 }
        prog.attributeList.push(info)
        prog.attributeByName.set(attr.name, info)
      }
      prog.uniformList = []
      prog.uniformByName = new Map()
      for (const uni of parsed.uniforms) {
        const loc = { name: uni.key, program: prog }
        prog.uniformByName.set(uni.key, loc)
        prog.uniformByName.set(uni.name, loc)
        prog.uniformList.push({ name: uni.name, type: GL_TYPE[uni.glsl], size: uni.size, location: loc })
      }
    },
    getProgramParameter(prog, pname) {
      if (pname === GL.DELETE_STATUS) return false
      if (pname === GL.ACTIVE_ATTRIBUTES) return prog?.attributeList.length ?? 0
      if (pname === GL.ACTIVE_UNIFORMS) return prog?.uniformList.length ?? 0
      if (pname === GL.ATTACHED_SHADERS) return prog?.shaders.length ?? 0
      return true
    },
    getProgramInfoLog: () => '',
    getActiveAttrib: (prog, index) => prog?.attributeList[index] ?? null,
    getActiveUniform: (prog, index) => prog?.uniformList[index] ?? null,
    getAttribLocation: (prog, name) => prog?.attributeByName.get(name)?.location ?? -1,
    getUniformLocation: (prog, name) => prog?.uniformByName.get(name) ?? null,
    useProgram(prog) {
      program = prog
    },
    deleteProgram() {},
    isProgram: (prog) => Boolean(prog && prog.values),
    validateProgram() {},
    uniform1f: (loc, x) => loc && loc.program.values.set(loc.name, [x]),
    uniform1i: (loc, x) => loc && loc.program.values.set(loc.name, [x]),
    uniform2f: (loc, x, y) => loc && loc.program.values.set(loc.name, [x, y]),
    uniform3f: (loc, x, y, z) => loc && loc.program.values.set(loc.name, [x, y, z]),
    uniform4f: (loc, x, y, z, w) => loc && loc.program.values.set(loc.name, [x, y, z, w]),
    uniform1fv: (loc, v) => loc && loc.program.values.set(loc.name, Array.from(v)),
    uniform1iv: (loc, v) => loc && loc.program.values.set(loc.name, Array.from(v)),
    uniform2fv: (loc, v) => loc && loc.program.values.set(loc.name, Array.from(v)),
    uniform3fv: (loc, v) => loc && loc.program.values.set(loc.name, Array.from(v)),
    uniform4fv: (loc, v) => loc && loc.program.values.set(loc.name, Array.from(v)),
    uniform2iv: (loc, v) => loc && loc.program.values.set(loc.name, Array.from(v)),
    uniform3iv: (loc, v) => loc && loc.program.values.set(loc.name, Array.from(v)),
    uniform4iv: (loc, v) => loc && loc.program.values.set(loc.name, Array.from(v)),
    uniformMatrix2fv: (loc, _transpose, v) => loc && loc.program.values.set(loc.name, Array.from(v)),
    uniformMatrix3fv: (loc, _transpose, v) => loc && loc.program.values.set(loc.name, Array.from(v)),
    uniformMatrix4fv: (loc, _transpose, v) => loc && loc.program.values.set(loc.name, Array.from(v)),
    drawArrays(mode, first, count) {
      draw(mode, count | 0, (i) => (first | 0) + i)
    },
    drawElements(mode, count, type, offset) {
      const stride = indexStride(type)
      const buffer = vao.elementBuffer
      draw(mode, count | 0, (i) => readIndex(buffer, type, (offset | 0) + i * stride))
    },
    drawArraysInstanced(mode, first, count, primcount) {
      drawInstanced(primcount, () => api.drawArrays(mode, first, count))
    },
    drawElementsInstanced(mode, count, type, offset, primcount) {
      drawInstanced(primcount, () => api.drawElements(mode, count, type, offset))
    },
    flush() {
      flushCommands()
    },
    finish() {
      flushCommands()
    },
  }

  const extra = new Map()
  let extraN = 0x100000
  const noop = () => {}
  return new Proxy(api, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined
      if (prop in target) return target[prop]
      if (typeof prop === 'string' && /^[A-Z][A-Z0-9_]*$/.test(prop)) {
        if (!extra.has(prop)) extra.set(prop, extraN++)
        return extra.get(prop)
      }
      return noop
    },
    set(target, prop, value) {
      target[prop] = value
      return true
    },
  })
}
