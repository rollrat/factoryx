import {
  ORE_ANCHORS,
  cellKey,
  directionForRotation,
  footprint,
  machinePorts,
  sameDirection,
} from "./config";
import type { BeltItem, BuildType, ItemType, MachineState, SelectedInfo, StructureData } from "./types";

const PROCESS_TIME = {
  miner: 2.1,
  smelter: 2.7,
  assembler: 3.4,
} as const;

export class FactorySimulation {
  readonly structures = new Map<number, StructureData>();
  readonly occupancy = new Map<string, number>();
  readonly machines = new Map<number, MachineState>();
  readonly beltItems = new Map<number, BeltItem>();

  private nextItemId = 1;
  private inputPorts = new Map<string, number>();

  addStructure(data: StructureData) {
    this.structures.set(data.id, { ...data });
    footprint(data.type, data.x, data.z).forEach((cell) => this.occupancy.set(cell, data.id));
    if (data.type !== "belt") {
      this.machines.set(data.id, {
        input: [],
        output: [],
        progress: 0,
        working: false,
        activity: 0,
        animationTime: 0,
        stored: 0,
      });
    }
    this.rebuildPorts();
  }

  removeStructure(id: number) {
    const data = this.structures.get(id);
    if (!data) return null;
    footprint(data.type, data.x, data.z).forEach((cell) => this.occupancy.delete(cell));
    this.structures.delete(id);
    this.machines.delete(id);
    this.beltItems.delete(id);
    this.rebuildPorts();
    return { ...data };
  }

  canPlace(type: BuildType, x: number, z: number, reserved?: Set<string>) {
    const cells = footprint(type, x, z);
    const inside = cells.every((cell) => {
      const [cellX, cellZ] = cell.split(",").map(Number);
      return Math.abs(cellX) <= 12 && Math.abs(cellZ) <= 12;
    });
    if (!inside) return false;
    if (type === "miner" && !ORE_ANCHORS.has(cellKey(x, z))) return false;
    return cells.every((cell) => !this.occupancy.has(cell) && !reserved?.has(cell));
  }

  getStructureAt(x: number, z: number) {
    const id = this.occupancy.get(cellKey(x, z));
    return id === undefined ? null : this.structures.get(id) ?? null;
  }

  hasOutputConnection(data: StructureData) {
    if (data.type === "belt") return false;
    const ports = machinePorts(data);
    const belt = this.getStructureAt(ports.output.x, ports.output.z);
    return belt?.type === "belt" && sameDirection(directionForRotation(belt.rotation), ports.flow);
  }

  hasInputConnection(data: StructureData) {
    if (data.type === "belt") return false;
    const ports = machinePorts(data);
    const belt = this.getStructureAt(ports.input.x, ports.input.z);
    return belt?.type === "belt" && sameDirection(directionForRotation(belt.rotation), ports.flow);
  }

  getStoredComponents() {
    let total = 0;
    this.structures.forEach((data, id) => {
      if (data.type === "storage") total += this.machines.get(id)?.stored ?? 0;
    });
    return total;
  }

  getSelectedInfo(id: number): SelectedInfo {
    const data = this.structures.get(id);
    if (!data) return null;
    if (data.type === "belt") {
      const item = this.beltItems.get(id);
      return {
        id,
        type: data.type,
        status: item ? "운송 중" : "대기",
        progress: item?.progress ?? 0,
        inputCount: item ? 1 : 0,
        outputCount: 0,
      };
    }
    const state = this.machines.get(id);
    if (!state) return null;
    let status = "재료 대기";
    if (data.type === "storage") status = state.stored > 0 ? "보관 중" : "입고 대기";
    else if (state.working) status = "가동 중";
    else if (state.output.length > 0) status = this.hasOutputConnection(data) ? "출력 대기" : "벨트 연결 필요";
    return {
      id,
      type: data.type,
      status,
      progress: state.progress,
      inputCount: data.type === "storage" ? state.stored : state.input.length,
      outputCount: state.output.length,
    };
  }

  update(delta: number) {
    this.updateMachines(delta);
    this.dispatchMachineOutputs();
    this.updateBelts(delta);
  }

  private updateMachines(delta: number) {
    this.structures.forEach((data, id) => {
      if (data.type === "belt" || data.type === "storage") return;
      const state = this.machines.get(id);
      if (!state) return;

      if (!state.working && state.output.length === 0) {
        if (data.type === "miner") {
          state.working = true;
          state.progress = 0;
        }
        if (data.type === "smelter") {
          const oreIndex = state.input.indexOf("ore");
          if (oreIndex >= 0) {
            state.input.splice(oreIndex, 1);
            state.working = true;
            state.progress = 0;
          }
        }
        if (data.type === "assembler") {
          const ingots = state.input.filter((item) => item === "ingot").length;
          if (ingots >= 2) {
            let removed = 0;
            state.input = state.input.filter((item) => item !== "ingot" || removed++ >= 2);
            state.working = true;
            state.progress = 0;
          }
        }
      }

      if (state.working) {
        state.progress += delta / PROCESS_TIME[data.type];
        if (state.progress >= 1) {
          const output: ItemType = data.type === "miner" ? "ore" : data.type === "smelter" ? "ingot" : "component";
          state.output.push(output);
          state.progress = 0;
          state.working = false;
        }
      }

      const targetActivity = state.working ? 1 : 0;
      state.activity += (targetActivity - state.activity) * (1 - Math.exp(-delta * 8));
      state.animationTime += delta * state.activity;
    });
  }

  private dispatchMachineOutputs() {
    this.structures.forEach((data, id) => {
      if (data.type === "belt" || data.type === "storage") return;
      const state = this.machines.get(id);
      if (!state?.output.length) return;
      const ports = machinePorts(data);
      const belt = this.getStructureAt(ports.output.x, ports.output.z);
      if (!belt || belt.type !== "belt" || this.beltItems.has(belt.id)) return;
      if (!sameDirection(directionForRotation(belt.rotation), ports.flow)) return;
      this.beltItems.set(belt.id, {
        id: this.nextItemId++,
        type: state.output.shift() as ItemType,
        progress: 0,
      });
    });
  }

  private updateBelts(delta: number) {
    const snapshot = Array.from(this.beltItems.entries());
    snapshot.forEach(([beltId, item]) => {
      if (this.beltItems.get(beltId) !== item) return;
      const belt = this.structures.get(beltId);
      if (!belt || belt.type !== "belt") {
        this.beltItems.delete(beltId);
        return;
      }
      item.progress += delta * 0.86;
      if (item.progress < 1) return;

      const direction = directionForRotation(belt.rotation);
      const inputMachineId = this.inputPorts.get(cellKey(belt.x, belt.z));
      if (inputMachineId !== undefined) {
        const machine = this.structures.get(inputMachineId);
        if (machine && sameDirection(machinePorts(machine).flow, direction) && this.acceptItem(inputMachineId, item.type)) {
          this.beltItems.delete(beltId);
          return;
        }
      }

      const next = this.getStructureAt(belt.x + direction.x, belt.z + direction.z);
      if (next?.type === "belt" && !this.beltItems.has(next.id)) {
        this.beltItems.delete(beltId);
        item.progress -= 1;
        this.beltItems.set(next.id, item);
      } else {
        item.progress = 0.98;
      }
    });
  }

  private acceptItem(machineId: number, item: ItemType) {
    const machine = this.structures.get(machineId);
    const state = this.machines.get(machineId);
    if (!machine || !state) return false;
    if (machine.type === "smelter" && item === "ore" && state.input.length < 2) {
      state.input.push(item);
      return true;
    }
    if (machine.type === "assembler" && item === "ingot" && state.input.length < 4) {
      state.input.push(item);
      return true;
    }
    if (machine.type === "storage" && item === "component") {
      state.stored += 1;
      return true;
    }
    return false;
  }

  private rebuildPorts() {
    this.inputPorts.clear();
    this.structures.forEach((data) => {
      if (data.type === "belt" || data.type === "miner") return;
      const input = machinePorts(data).input;
      this.inputPorts.set(cellKey(input.x, input.z), data.id);
    });
  }
}
