// 显示用 WebGL2 查看器:轨道相机、多网格实例、面片热染色/风险染色
import type { Mesh, Vec3 } from '../core/types';
import { mat4LookAt, mat4Multiply, mat4Perspective, mat4RotationX, mat4RotationY, v3, type Mat4 } from '../core/math';

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in float aColor;
uniform mat4 uModel;
uniform mat4 uViewProj;
out vec3 vN; out vec3 vW; out float vC;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = mat3(uModel) * aNormal;
  vC = aColor;
  gl_Position = uViewProj * w;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vN; in vec3 vW; in float vC;
uniform vec3 uBase;
uniform int uMode; // 0 固定色 1 热力 2 风险
uniform vec3 uCam;
out vec4 frag;
vec3 heat(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c1 = vec3(0.23,0.29,0.42), c2 = vec3(0.31,0.63,1.0);
  vec3 c3 = vec3(0.21,0.82,0.73), c4 = vec3(1.0,0.69,0.13), c5 = vec3(1.0,0.36,0.36);
  if (t < 0.25) return mix(c1,c2,t/0.25);
  if (t < 0.5) return mix(c2,c3,(t-0.25)/0.25);
  if (t < 0.75) return mix(c3,c4,(t-0.5)/0.25);
  return mix(c4,c5,(t-0.75)/0.25);
}
void main() {
  vec3 N = normalize(vN);
  vec3 L = normalize(vec3(0.4, 0.6, 0.8));
  float diff = 0.35 + 0.65 * abs(dot(N, L));
  vec3 base = uBase;
  if (uMode == 1) base = heat(vC);
  else if (uMode == 2) {
    if (vC > 1.5) base = vec3(1.0,0.36,0.36);      // 杂晶红
    else if (vC > 0.5) base = vec3(1.0,0.69,0.13); // 雀斑橙
    else if (vC > 0.05) base = vec3(0.21,0.82,0.73); // 低风险青
    else base = vec3(0.45,0.55,0.68);
  }
  vec3 col = base * diff;
  // 边缘描边
  vec3 V = normalize(uCam - vW);
  float rim = pow(1.0 - abs(dot(N, V)), 3.0) * 0.25;
  col += rim * vec3(0.3,0.5,0.8);
  frag = vec4(col, 1.0);
}`;

export interface ViewerMesh {
  mesh: Mesh;
  model: Mat4;
  baseColor: Vec3;
  colorByVertex?: Float32Array; // 每顶点 0~1 或风险码
}

export class GLViewer {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  meshes: ViewerMesh[] = [];
  yaw = 0.7; pitch = 0.5; dist = 0.75;
  target: Vec3 = [0, 0, 0.18];
  private uModel: WebGLUniformLocation;
  private uViewProj: WebGLUniformLocation;
  private uBase: WebGLUniformLocation;
  private uMode: WebGLUniformLocation;
  private uCam: WebGLUniformLocation;
  mode: 0 | 1 | 2 = 0;
  highlight: number[] = []; // 标红的叶片 owner
  private dragging = false;
  private lastX = 0; private lastY = 0;
  onPick?: (owner: number) => void;
  ownerByColor = new Map<number, number>();

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL2 不可用');
    this.gl = gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(this.program);
    this.uModel = gl.getUniformLocation(this.program, 'uModel')!;
    this.uViewProj = gl.getUniformLocation(this.program, 'uViewProj')!;
    this.uBase = gl.getUniformLocation(this.program, 'uBase')!;
    this.uMode = gl.getUniformLocation(this.program, 'uMode')!;
    this.uCam = gl.getUniformLocation(this.program, 'uCam')!;
    this.vao = gl.createVertexArray()!;
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    this.bindInteraction();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.resize();
  }

  private bindInteraction() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => {
      this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', e => {
      if (!this.dragging) return;
      this.yaw -= (e.clientX - this.lastX) * 0.008;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + (e.clientY - this.lastY) * 0.008));
      this.lastX = e.clientX; this.lastY = e.clientY;
      this.render();
    });
    c.addEventListener('pointerup', () => { this.dragging = false; });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.dist = Math.max(0.12, Math.min(3, this.dist * (1 + Math.sign(e.deltaY) * 0.08)));
      this.render();
    }, { passive: false });
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
    this.render();
  }

  setMeshes(meshes: ViewerMesh[]) {
    this.meshes = meshes;
    this.render();
  }

  private cameraMat(): { vp: Mat4; eye: Vec3 } {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const eye: Vec3 = [
      this.target[0] + this.dist * cp * Math.cos(this.yaw),
      this.target[1] + this.dist * cp * Math.sin(this.yaw),
      this.target[2] + this.dist * sp,
    ];
    const view = mat4LookAt(eye, this.target, [0, 0, 1]);
    const proj = mat4Perspective(Math.PI / 5, this.canvas.width / this.canvas.height, 0.01, 20);
    return { vp: mat4Multiply(proj, view), eye };
  }

  render() {
    const gl = this.gl;
    if (!this.meshes.length) return;
    gl.clearColor(0.06, 0.08, 0.11, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    const { vp, eye } = this.cameraMat();
    gl.uniformMatrix4fv(this.uViewProj, false, vp);
    gl.uniform3fv(this.uCam, eye);
    gl.uniform1i(this.uMode, this.mode);

    for (const vm of this.meshes) {
      const m = vm.mesh;
      // pos
      let buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      // normal
      buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, m.normals, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      // color
      const colors = vm.colorByVertex ?? new Float32Array(m.positions.length / 3);
      buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
      // index
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
      gl.uniformMatrix4fv(this.uModel, false, vm.model);
      gl.uniform3fv(this.uBase, vm.baseColor);
      gl.drawElements(gl.TRIANGLES, m.indices.length, gl.UNSIGNED_INT, 0);
      gl.deleteBuffer(buf); gl.deleteBuffer(ibo);
    }
    gl.bindVertexArray(null);
  }
}

export function orbitPreset(v: GLViewer, preset: 'top' | 'side' | 'iso') {
  if (preset === 'top') { v.yaw = 0.7; v.pitch = 1.35; }
  if (preset === 'side') { v.yaw = 0; v.pitch = 0.05; }
  if (preset === 'iso') { v.yaw = 0.7; v.pitch = 0.5; }
  v.render();
}

export const colorHeat = (t: number): Vec3 => {
  const x = Math.max(0, Math.min(1, t));
  // 与 shader 近似
  void x;
  return [0, 0, 0];
};

export function matFromEuler(az: number, tilt: number): Mat4 {
  return mat4Multiply(mat4RotationY(az), mat4RotationX(tilt));
}

export { v3 };
