import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { createFakeWebGL } from './webgl-fake.mjs'

function makeHost(w = 32, h = 32) {
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  const issues: Array<{ code?: string; message?: string }> = []
  const raw = ctx.getImageData.bind(ctx)
  const gl = createFakeWebGL({ canvas, ctx, element: canvas, report: (issue: { code?: string; message?: string }) => issues.push(issue) }, {})
  return { gl, issues, raw }
}

function redTriangle(gl: ReturnType<typeof createFakeWebGL>) {
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 16, 0, 8, 16]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.vertexAttrib4f(1, 1, 0, 0, 1)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  return buf
}

describe('webgl command recorder', () => {
  it('画在 flush 之前不落到画布上', () => {
    const { gl, raw } = makeHost()
    redTriangle(gl)
    expect(raw(8, 6, 1, 1).data[0]).toBe(0)
    gl.flush()
    expect(raw(8, 6, 1, 1).data[0]).toBe(255)
    expect(raw(4, 20, 1, 1).data[0]).toBe(0)
  })

  it('draw 之后改缓冲，已经记下的三角形不变', () => {
    const { gl, raw } = makeHost()
    const buf = redTriangle(gl)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([400, 400, 420, 400, 410, 430]))
    gl.finish()
    expect(raw(8, 6, 1, 1).data[0]).toBe(255)
  })

  it('清屏和三角形按记录顺序画', () => {
    const { gl, raw } = makeHost()
    gl.clearColor(0, 0, 1, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    redTriangle(gl)
    gl.flush()
    const ink = raw(8, 6, 1, 1).data
    expect([ink[0], ink[2]]).toEqual([255, 0])
    const sky = raw(1, 30, 1, 1).data
    expect([sky[0], sky[2]]).toEqual([0, 255])
  })

  it('UNSIGNED_BYTE 顶点按像素坐标光栅', () => {
    const { gl, raw } = makeHost()
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array([0, 0, 20, 0, 0, 20]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.UNSIGNED_BYTE, false, 0, 0)
    gl.vertexAttrib4f(1, 0, 1, 0, 1)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.flush()
    const px = raw(2, 2, 1, 1).data
    expect(px[1]).toBe(255)
    expect(px[0]).toBe(0)
  })

  it('three.js r159 的内置材质报 unsupported-webgl', () => {
    const { gl, issues } = makeHost()
    const prog = gl.createProgram()
    const vs = gl.createShader(gl.VERTEX_SHADER)
    const fs = gl.createShader(gl.FRAGMENT_SHADER)
    gl.shaderSource(vs, 'attribute vec3 position; void main(){ gl_Position = vec4(position, 1.0); }')
    gl.shaderSource(fs, '#define SHADER_TYPE MeshStandardMaterial\n#define THREE_REVISION 159\nvoid main(){ gl_FragColor = vec4(1.0); }')
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.useProgram(prog)
    redTriangle(gl)
    expect(issues.some((issue) => issue.code === 'unsupported-webgl' && issue.message?.includes('159'))).toBe(true)
  })

  it('扩展、mip 和立方体贴图按 WebGL 记下来', () => {
    const { gl } = makeHost()
    const ext = gl.getExtension('ANGLE_instanced_arrays')
    expect(typeof ext.drawArraysInstancedANGLE).toBe('function')
    expect(gl.getSupportedExtensions()).toContain('OES_element_index_uint')
    expect(gl.getParameter(gl.MAX_VERTEX_ATTRIBS)).toBe(16)
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(16).fill(200))
    gl.generateMipmap(gl.TEXTURE_2D)
    expect(tex.mips).toHaveLength(2)
    expect(tex.mips[1]).toHaveLength(4)
    const cube = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, cube)
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([9, 8, 7, 6]))
    expect(cube.faces[gl.TEXTURE_CUBE_MAP_POSITIVE_X].data[0]).toBe(9)
  })
})
