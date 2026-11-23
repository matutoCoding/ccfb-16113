// 标准半立方体法角系数 WebGL2 引擎
// 布局:顶面 N×N(z=n),四个侧面 2N(宽)×N(高)矩形,仅覆盖上半球。
// 每面独立 FBO(规避部分 ANGLE 驱动的 scissor/图集缺陷),面片 ID 编码到 RGBA8。
import type { PatchInfo, ViewFactorMatrix, Vec3 } from './types';
import { v3, type Mat4, mat4Perspective } from './math';

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in float aPatchId;
uniform mat4 uMVP;
flat out uint vId;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vId = uint(aPatchId) + 1u; // 0 留给背景
}`;

const FRAG = `#version 300 es
precision highp float;
flat in uint vId;
uniform uint uSkipId; // 0 表示不跳过
out vec4 outColor;
void main() {
  if (uSkipId != 0u && vId == uSkipId) discard;
  uint id = vId;
  outColor = vec4(
    float(id & 255u),
    float((id >> 8) & 255u),
    float((id >> 16) & 255u),
    255.0) / 255.0;
}`;

export interface SceneGeometry {
  positions: Float32Array;
  indices: Uint32Array;
  triPatch: Uint32Array;
  patches: PatchInfo[];
  ambientPatchIndex: number;
}

export interface HemicubeOptions {
  log?: (msg: string) => void;
  receiverFilter?: (p: PatchInfo, i: number) => boolean;
}

export interface HemicubeResult {
  matrix: ViewFactorMatrix;
  weights: Float32Array;
  pixelAccum?: Float32Array;
  lastReceiver?: number;
}

/** 单个半立方体面的相机帧:视线 d、屏幕右 s、屏幕上 u(均为世界单位向量) */
interface FaceFrame {
  d: Vec3; s: Vec3; u: Vec3;
  proj: Mat4;
  width: number;   // 像素宽
  height: number;  // 像素高
  weight: Float32Array; // 与像素行主序对齐
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('着色器编译失败: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

interface RenderTarget { fbo: WebGLFramebuffer; tex: WebGLTexture; depth: WebGLRenderbuffer; w: number; h: number; }

export class HemicubeEngine {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  posBuf: WebGLBuffer;
  idBuf: WebGLBuffer;
  idxBuf: WebGLBuffer;
  targets: RenderTarget[] = [];
  indexCount = 0;
  res = 64;
  /** 相机沿法线的抬升量;uploadScene 时按最小面片特征尺寸自动设定 */
  rayOffset = 1e-4;
  uMVP: WebGLUniformLocation;
  uSkip: WebGLUniformLocation;
  scene: SceneGeometry | null = null;
  private pixelBufs: Uint8Array[] = [];

  constructor(res = 64) {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: true,
      preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.res = res;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(prog));
    }
    this.program = prog;
    this.uMVP = gl.getUniformLocation(prog, 'uMVP')!;
    this.uSkip = gl.getUniformLocation(prog, 'uSkipId')!;

    this.vao = gl.createVertexArray()!;
    this.posBuf = gl.createBuffer()!;
    this.idBuf = gl.createBuffer()!;
    this.idxBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.idBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bindVertexArray(null);

    // 顶面 N×N;四个侧面 2N×N
    const N = res;
    this.targets = [
      this.makeTarget(N, N),
      this.makeTarget(2 * N, N),
      this.makeTarget(2 * N, N),
      this.makeTarget(2 * N, N),
      this.makeTarget(2 * N, N),
    ];
    this.pixelBufs = this.targets.map(t => new Uint8Array(t.w * t.h * 4));

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE); // 双面渲染,靠 skip 处理自身
  }

  private makeTarget(w: number, h: number): RenderTarget {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    return { fbo, tex, depth, w, h };
  }

  /** 顶面权重 N×N:ΔF = dA/(π(1+u²+v²)²),u,v∈[-1,1] */
  private topWeight(N: number): Float32Array {
    const lut = new Float32Array(N * N);
    const du = 2 / N, dA = du * du;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = -1 + (x + 0.5) * du;
        const v = -1 + (y + 0.5) * du;
        const r2 = 1 + u * u + v * v;
        lut[y * N + x] = dA / (Math.PI * r2 * r2);
      }
    }
    return lut;
  }

  /** 侧面权重 2N×N:水平 a∈[-1,1],垂直 z∈[0,1];ΔF = z·dA/(π(1+a²+z²)²) */
  private sideWeight(N: number): Float32Array {
    const W = 2 * N;
    const lut = new Float32Array(W * N);
    const da = 2 / W, dz = 1 / N, dA = da * dz;
    for (let y = 0; y < N; y++) {
      const z = (y + 0.5) * dz; // [0,1]
      for (let x = 0; x < W; x++) {
        const a = -1 + (x + 0.5) * da;
        const r2 = 1 + a * a + z * z;
        lut[y * W + x] = (z * dA) / (Math.PI * r2 * r2);
      }
    }
    return lut;
  }

  /** 构造五面相机帧(相机位于原点) */
  private faceFrames(nIn: Vec3): FaceFrame[] {
    const n = v3.norm(nIn);
    const ref: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const t = v3.norm(v3.cross(ref, n));
    const b = v3.norm(v3.cross(t, n));
    const N = this.res;
    const viewOf = (d: Vec3, s: Vec3, u: Vec3): Mat4 => {
      // 列主序视图矩阵:行 = 相机基向量,相机在原点(平移列为 0)
      const m = new Float32Array(16);
      m[0] = s[0]; m[4] = s[1]; m[8] = s[2];
      m[1] = u[0]; m[5] = u[1]; m[9] = u[2];
      m[2] = -d[0]; m[6] = -d[1]; m[10] = -d[2];
      m[15] = 1;
      return m;
    };
    const topProj = mat4Perspective(Math.PI / 2, 1, 1e-5, 100);
    const sideProj = mat4Perspective(Math.PI / 2, 2, 1e-5, 100); // 宽高比 2
    const topW = this.topWeight(N);
    const sideW = this.sideWeight(N);
    return [
      { d: n, s: t, u: b, proj: topProj, width: N, height: N, weight: topW },
      { d: t, s: v3.scale(n, -1), u: b, proj: sideProj, width: 2 * N, height: N, weight: sideW },
      { d: v3.scale(t, -1), s: n, u: b, proj: sideProj, width: 2 * N, height: N, weight: sideW },
      { d: b, s: t, u: n, proj: sideProj, width: 2 * N, height: N, weight: sideW },
      { d: v3.scale(b, -1), s: v3.scale(t, -1), u: n, proj: sideProj, width: 2 * N, height: N, weight: sideW },
    ].map(f => ({ ...f, proj: f.proj }));
  }

  uploadScene(scene: SceneGeometry) {
    this.scene = scene;
    const gl = this.gl;
    // 抬升量取所有非环境面片面积平方根的 1‰,下限 1e-6 m
    let minDim = Infinity;
    for (const p of scene.patches) {
      if (p.kind === 'ambient') continue;
      minDim = Math.min(minDim, Math.sqrt(p.area));
    }
    // 抬升量取所有非环境面片最小特征尺寸的 5%(微元偏移,远小于最小间距)
    this.rayOffset = Math.max(1e-6, minDim * 0.05);
    const ids = new Float32Array(scene.positions.length / 3);
    for (let t = 0; t < scene.triPatch.length; t++) {
      const id = scene.triPatch[t];
      ids[scene.indices[t * 3]] = id;
      ids[scene.indices[t * 3 + 1]] = id;
      ids[scene.indices[t * 3 + 2]] = id;
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, scene.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.idBuf);
    gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, scene.indices, gl.STATIC_DRAW);
    this.indexCount = scene.indices.length;
    gl.bindVertexArray(null);
  }

  /** 渲染一个接收面片的五面,返回每面的 ID 像素缓冲 */
  private renderFaces(receiverIndex: number): { frames: FaceFrame[]; bufs: Uint8Array[] } {
    const gl = this.gl;
    const scene = this.scene!;
    const patch = scene.patches[receiverIndex];
    const frames = this.faceFrames(patch.normal);
    // 相机沿接收面片法线抬升一个与最小面片尺寸成比例的 ε,
    // 避免相机恰在表面平面时,相邻几何在掠射角刺穿近平面污染侧面。
    const eps = this.rayOffset;
    const ox = patch.centroid[0] + patch.normal[0] * eps;
    const oy = patch.centroid[1] + patch.normal[1] * eps;
    const oz = patch.centroid[2] + patch.normal[2] * eps;
    const trans = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, -ox, -oy, -oz, 1]);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1ui(this.uSkip, receiverIndex + 1);
    const bufs: Uint8Array[] = [];
    for (let f = 0; f < 5; f++) {
      const frame = frames[f];
      const target = this.targets[f];
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
      // MVP = proj · view · trans
      const vt = mul4(viewOfFrame(frame), trans);
      const mvp = mul4(frame.proj, vt);
      gl.uniformMatrix4fv(this.uMVP, false, mvp);
      gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
      const buf = this.pixelBufs[f];
      gl.readPixels(0, 0, target.w, target.h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      bufs.push(buf);
    }
    return { frames, bufs };
  }

  computeAll(opts: HemicubeOptions = {}): HemicubeResult {
    const gl = this.gl;
    if (!this.scene) throw new Error('尚未上传场景');
    const scene = this.scene;
    const n = scene.patches.length;
    const rows = new Float32Array(n * n);
    const rowResidual = new Float32Array(n);
    const receivers: number[] = [];
    for (let i = 0; i < n; i++) {
      if (scene.patches[i].kind === 'ambient') continue;
      if (opts.receiverFilter && !opts.receiverFilter(scene.patches[i], i)) continue;
      receivers.push(i);
    }
    const accum = new Float32Array(n);
    let lastDetail: Float32Array | undefined;

    const t0 = performance.now();
    for (const ri of receivers) {
      const { frames, bufs } = this.renderFaces(ri);
      accum.fill(0);
      let sum = 0;
      for (let f = 0; f < 5; f++) {
        const buf = bufs[f], w = frames[f].weight, W = frames[f].width, H = frames[f].height;
        for (let p = 0, idx = 0; p < buf.length; p += 4, idx++) {
          const id = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
          if (id === 0) continue;
          const weight = w[idx];
          accum[id - 1] += weight;
          sum += weight;
        }
        void H;
      }
      const miss = Math.max(0, 1 - sum);
      if (scene.ambientPatchIndex >= 0) accum[scene.ambientPatchIndex] += miss;
      rows.set(accum, ri * n);
      rowResidual[ri] = sum - 1;
      if (ri === receivers[0]) lastDetail = accum.slice();
    }
    const ms = performance.now() - t0;
    opts.log?.(`半立方体 ${receivers.length} 个接收面片 × 5 面,分辨率 ${this.res},耗时 ${ms.toFixed(0)} ms`);
    void gl;

    const matrix: ViewFactorMatrix = {
      receiverIds: scene.patches.map((_, i) => i),
      sourceIds: scene.patches.map((_, i) => i),
      rows,
      rowResidual,
      hemicubeRes: this.res,
      computedAt: Date.now(),
      displacement: 0,
    };
    return { matrix, weights: this.topWeightPublic(), pixelAccum: lastDetail, lastReceiver: receivers[0] };
  }

  /** 顶面权重(供外部查询 ΔF 核函数) */
  topWeightPublic(): Float32Array {
    return this.topWeight(this.res);
  }

  /** 单个接收面片的累加明细(配对检查页) */
  computeOne(receiverIndex: number): { accum: Float32Array; pixelCount: Int32Array; rowSum: number } {
    const scene = this.scene!;
    const n = scene.patches.length;
    const { frames, bufs } = this.renderFaces(receiverIndex);
    const accum = new Float32Array(n);
    const pixelCount = new Int32Array(n);
    let rowSum = 0;
    for (let f = 0; f < 5; f++) {
      const buf = bufs[f], w = frames[f].weight, W = frames[f].width;
      for (let p = 0, idx = 0; p < buf.length; p += 4, idx++) {
        const id = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
        if (id === 0) continue;
        const weight = w[idx];
        accum[id - 1] += weight;
        pixelCount[id - 1]++;
        rowSum += weight;
      }
      void W;
    }
    return { accum, pixelCount, rowSum };
  }

  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.posBuf);
    gl.deleteBuffer(this.idBuf);
    gl.deleteBuffer(this.idxBuf);
    for (const t of this.targets) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
      gl.deleteRenderbuffer(t.depth);
    }
    const ext = gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}

/** 由 FaceFrame 重建视图矩阵(与 faceFrames 内部一致) */
function viewOfFrame(f: FaceFrame): Mat4 {
  const m = new Float32Array(16);
  m[0] = f.s[0]; m[4] = f.s[1]; m[8] = f.s[2];
  m[1] = f.u[0]; m[5] = f.u[1]; m[9] = f.u[2];
  m[2] = -f.d[0]; m[6] = -f.d[1]; m[10] = -f.d[2];
  m[15] = 1;
  return m;
}

function mul4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/** 互换关系对称化:F'ij = (Ai Fij + Aj Fji)/(2 Ai),再行归一化 */
export function symmetrize(F: Float32Array, areas: Float32Array, n: number): Float32Array {
  const out = new Float32Array(F.length);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out[i * n + j] = (areas[i] * F[i * n + j] + areas[j] * F[j * n + i]) / (2 * areas[i]);
    }
  }
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += out[i * n + j];
    if (s > 0) for (let j = 0; j < n; j++) out[i * n + j] /= s;
  }
  return out;
}

export function rowSum(F: Float32Array, i: number, n: number): number {
  let s = 0;
  for (let j = 0; j < n; j++) s += F[i * n + j];
  return s;
}
