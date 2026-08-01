import type { BuildType, Cell, Direction, MachinePorts, StructureData, Tool } from "./types";

export const TOOL_INFO: Array<{
  id: Tool;
  name: string;
  glyph: string;
  key: string;
  cost?: number;
}> = [
  { id: "inspect", name: "선택", glyph: "◎", key: "1" },
  { id: "belt", name: "벨트", glyph: "≫", key: "2", cost: 8 },
  { id: "miner", name: "채굴기", glyph: "M", key: "3", cost: 120 },
  { id: "smelter", name: "제련기", glyph: "S", key: "4", cost: 180 },
  { id: "assembler", name: "조립기", glyph: "A", key: "5", cost: 260 },
  { id: "storage", name: "창고", glyph: "▣", key: "6", cost: 90 },
  { id: "demolish", name: "철거", glyph: "×", key: "X" },
];

export const COST: Record<BuildType, number> = {
  belt: 8,
  miner: 120,
  smelter: 180,
  assembler: 260,
  storage: 90,
};

export const TYPE_NAME: Record<BuildType, string> = {
  belt: "컨베이어 Mk.1",
  miner: "철 채굴기",
  smelter: "아크 제련기",
  assembler: "정밀 조립기",
  storage: "소형 저장고",
};

export const TYPE_RATE: Record<BuildType, string> = {
  belt: "52 /분",
  miner: "24 /분",
  smelter: "18 /분",
  assembler: "10 /분",
  storage: "400 슬롯",
};

export const ORE_ANCHORS = new Set(["-8,-3", "7,4"]);

export const cellKey = (x: number, z: number) => `${x},${z}`;

export const directionForRotation = (rotation: number): Direction => {
  const directions: Direction[] = [
    { x: 0, z: 1 },
    { x: 1, z: 0 },
    { x: 0, z: -1 },
    { x: -1, z: 0 },
  ];
  return directions[((rotation % 4) + 4) % 4];
};

export const footprint = (type: BuildType, x: number, z: number) => {
  if (type === "belt") return [cellKey(x, z)];
  return [cellKey(x, z), cellKey(x + 1, z), cellKey(x, z + 1), cellKey(x + 1, z + 1)];
};

export const machinePorts = (data: StructureData): MachinePorts => {
  const rotation = ((data.rotation % 4) + 4) % 4;
  const machineDirections: Direction[] = [
    { x: 1, z: 0 },
    { x: 0, z: -1 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
  ];
  const flow = machineDirections[rotation];
  const ports: Array<{ input: Cell; output: Cell }> = [
    { input: { x: data.x - 1, z: data.z }, output: { x: data.x + 2, z: data.z } },
    { input: { x: data.x, z: data.z + 2 }, output: { x: data.x, z: data.z - 1 } },
    { input: { x: data.x + 2, z: data.z + 1 }, output: { x: data.x - 1, z: data.z + 1 } },
    { input: { x: data.x + 1, z: data.z - 1 }, output: { x: data.x + 1, z: data.z + 2 } },
  ];
  return { ...ports[rotation], flow };
};

export const sameDirection = (a: Direction, b: Direction) => a.x === b.x && a.z === b.z;
