// 领域模型与持久化数据结构。单位制:长度 m,温度 K,时间 s,热流 W/m²

export type Vec3 = [number, number, number];

export interface Mesh {
  positions: Float32Array; // xyz 交错
  normals: Float32Array;
  indices: Uint32Array;
  /** 可选:每个面片(三角形)所属的辐射面片 id,用于半立方体拾取归并 */
  triPatch?: Uint32Array;
}

/** 榫头(榫根)参数 */
export interface TenonParams {
  length: number;        // 沿叶高方向长度
  width: number;         // 弦向宽
  thickness: number;     // 厚度方向
  taper: number;         // 末端收缩比例 0~1
  serrations: number;    // 锯齿道数(视觉用)
}

/** 缘板参数 */
export interface PlatformParams {
  chord: number;
  width: number;
  thickness: number;
}

/** 叶身参数:沿高度若干截面 loft,截面为带厚度的流线型 */
export interface AirfoilParams {
  height: number;        // 叶身高度
  chordRoot: number;
  chordTip: number;
  thicknessRoot: number; // 最大厚度
  thicknessTip: number;
  twistRoot: number;     // rad
  twistTip: number;
  camber: number;        // 弯度 0~0.1
  bands: number;         // 高度方向分段(同时决定热网格)
  sectors: number;       // 环向分段(偶数)
}

/** 选晶器:pigtail 螺旋 / zigzag 折线 / block 方块 */
export interface SelectorParams {
  kind: 'spiral' | 'zigzag' | 'block';
  height: number;
  turns?: number;        // 螺旋圈数
  radius?: number;       // 螺旋半径
  tubeRadius?: number;
  zigCount?: number;
  width?: number;
}

/** 引晶段 */
export interface StarterParams {
  kind: 'cylinder' | 'square';
  height: number;
  radius?: number;
  width?: number;
}

/** 模壳:多层沾浆淋砂,厚度按层数累计 */
export interface ShellParams {
  layers: number;
  layerThickness: number; // 单层厚度 m
  conductivity: number;    // W/(m·K)
  emissivity: number;      // 0~1
  density: number;         // kg/m³
  specificHeat: number;    // J/(kg·K)
}

export interface BladeDef {
  id: string;
  name: string;
  updatedAt: number;
  tenon: TenonParams;
  platform: PlatformParams;
  airfoil: AirfoilParams;
  selector: SelectorParams;
  starter: StarterParams;
  shell: ShellParams;
  stlMesh?: Mesh;         // 导入 STL 时替换叶身几何
  materialConductivity: number; // 合金导热 W/(m·K)
  liquidus: number;       // 液相线 K
  solidus: number;        // 固相线 K
}

/** 组树上的一个叶片实例:在底盘极坐标上的排布 */
export interface BladeInstance {
  id: string;
  bladeDefId: string;
  radius: number;         // 距炉心半径 m
  azimuth: number;        // 方位角 rad
  yaw: number;            // 自身绕叶轴转角 rad(0 = 叶背朝炉心)
  tilt: number;           // 倾角 rad
  tiltDir: number;        // 倾斜方向方位角 rad
}

export interface ClusterDef {
  id: string;
  name: string;
  updatedAt: number;
  chillDiskRadius: number;
  instances: BladeInstance[];
}

export interface HeaterZone {
  id: string;
  name: string;
  zCenter: number;        // 炉心坐标系,z 向上,结晶器顶面 z=0
  height: number;
  radius: number;         // 加热器内表面半径
  temperature: number;    // K
  emissivity: number;
  segments: number;       // 周向分段
  bands: number;          // 轴向分段
}

export interface FurnaceDef {
  id: string;
  name: string;
  updatedAt: number;
  wallRadius: number;
  wallHeight: number;     // z 从 0 到 wallHeight
  wallEmissivity: number;
  zones: HeaterZone[];
  baffleZ: number;        // 隔热挡板高度
  baffleThickness: number;
  baffleOpeningRadius: number; // 挡板开孔半径
  baffleEmissivity: number;
  baffleTemp: number;
  /** 抽拉通道间隙:模壳外轮廓与挡板开孔之间的单边间隙 */
  pullGap: number;
  chillRadius: number;
  chillTemp: number;
  chillEmissivity: number;
  ambientTemp: number;    // 顶部/缝隙环境桶温度
}

/** 抽拉曲线关键点:位移(向下为正)与速度 */
export interface PullPoint {
  t: number;              // s
  displacement: number;   // m,向下抽拉位移
}

export interface PullCurve {
  id: string;
  name: string;
  points: PullPoint[];    // 按 t 升序
}

/** 辐射面片运行时描述 */
export interface PatchInfo {
  surfaceId: number;      // 全局表面 id
  kind: 'shell' | 'heater' | 'baffle' | 'chill' | 'wall' | 'ambient';
  ownerIndex: number;     // 叶片实例序号 / 炉区序号
  part?: string;          // 模壳部位:starter/selector/tenon/platform/airfoil/cap
  band: number;
  sector: number;
  centroid: Vec3;
  normal: Vec3;
  area: number;
}

export interface ViewFactorMatrix {
  receiverIds: number[];  // 行:接收面片 surfaceId
  sourceIds: number[];    // 列
  rows: Float32Array;     // rows.length = receiverIds.length * sourceIds.length
  rowResidual: Float32Array; // 归一化前每行求和偏差
  hemicubeRes: number;
  computedAt: number;
  displacement: number;   // 该矩阵对应的抽拉位移
}

export interface BandThermalState {
  z: number;
  /** 每列(周向 sector 归并到 4 列:内/外/左/右)温度 */
  colTemp: [number, number, number, number];
  colShellTemp: [number, number, number, number];
  gradient: [number, number, number, number]; // K/m
  irrTemp: [number, number, number, number];  // 入射辐射等效温度
}

export type RiskType = 'stray' | 'freckle' | 'none';

export interface BandRisk {
  band: number;
  z: number;
  tiltDeg: number;           // 固液界面倾斜角
  innerOuterDeltaT: number;  // 内外侧温差 K
  minGradient: number;       // 最小温度梯度 K/m
  pullSpeed: number;         // m/s
  freckleIndex: number;      // V/G^2 类指标
  strayRisk: number;         // 0~1
  freckleRisk: number;       // 0~1
  risk: RiskType;
}

export interface BladeSimResult {
  instanceId: string;
  bands: BandThermalState[];
  risks: BandRisk[];
  maxInnerOuterDeltaT: number;
  maxTiltDeg: number;
  worstBand: number;
}

export interface SimulationStep {
  index: number;
  t: number;
  displacement: number;
  speed: number;
  viewFactor: ViewFactorMatrix;
  blades: BladeSimResult[];
  computeMs: number;
}

export interface SimulationRun {
  id: string;
  name: string;
  createdAt: number;
  clusterId: string;
  furnaceId: string;
  curveId: string;
  hemicubeRes: number;
  stepCount: number;
  steps: SimulationStep[];
  /** 推演参数:风险阈值等 */
  tiltLimitDeg: number;
  gradientMin: number;
  freckleIndexLimit: number;
}

export interface DefectMark {
  bladeIndex: number;       // 组树中的叶片序号
  heightRatio: number;      // 0~1,沿叶高
  side: 'inner' | 'outer' | 'left' | 'right';
  type: 'stray' | 'freckle';
  note?: string;
}

export interface PourRecord {
  id: string;
  pourDate: number;
  furnaceHeatNo: string;    // 炉批号
  clusterId: string;
  furnaceId: string;
  curveId: string;
  simRunId?: string;
  totalBlades: number;
  scrapped: number;
  defects: DefectMark[];
  macroEtchNote: string;
  createdAt: number;
}

export type StoreEntity =
  | { type: 'blade'; data: BladeDef }
  | { type: 'cluster'; data: ClusterDef }
  | { type: 'furnace'; data: FurnaceDef }
  | { type: 'curve'; data: PullCurve }
  | { type: 'sim'; data: SimulationRun }
  | { type: 'record'; data: PourRecord };
