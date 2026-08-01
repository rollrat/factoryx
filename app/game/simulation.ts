import {
  ORE_ANCHORS,
  STORAGE_CAPACITY,
  cellKey,
  directionForRotation,
  footprint,
  machinePorts,
  sameDirection,
} from "./config.ts";
import { FixedStepClock } from "./sim/clock.ts";
import type { BeltItem, BuildType, ItemType, MachineState, SelectedInfo, StructureData } from "./types.ts";

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

  private readonly clock = new FixedStepClock();
  private nextItemId = 1;
  private inputPorts = new Map<string, { machineId: number; inputIndex: number }>();

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
        intakePulse: 0,
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
    if (data.type === "belt" || data.type === "storage") return false;
    const ports = machinePorts(data);
    const belt = this.getStructureAt(ports.output.x, ports.output.z);
    return belt?.type === "belt" && sameDirection(directionForRotation(belt.rotation), ports.flow);
  }

  hasInputConnection(data: StructureData) {
    if (data.type === "belt") return false;
    return this.getInputConnections(data).some(Boolean);
  }

  getInputConnections(data: StructureData) {
    if (data.type === "belt") return [];
    const ports = machinePorts(data);
    return ports.inputs.map((input) => {
      const belt = this.getStructureAt(input.x, input.z);
      return belt?.type === "belt" && sameDirection(directionForRotation(belt.rotation), ports.flow);
    });
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
      const jammed = Boolean(item && item.progress >= 0.979);
      return {
        id,
        type: data.type,
        status: jammed ? "출력 막힘" : item ? "운송 중" : "가동 대기",
        runtimeState: jammed ? "blocked" : item ? "working" : "idle",
        recipeName: "단일 품목 운송",
        progress: item?.progress ?? 0,
        inputCount: item ? 1 : 0,
        inputCapacity: 1,
        outputCount: jammed ? 1 : 0,
        outputCapacity: 1,
      };
    }
    const state = this.machines.get(id);
    if (!state) return null;
    let status = "재료 대기";
    let runtimeState: NonNullable<SelectedInfo>["runtimeState"] = "starved";
    if (data.type === "storage") {
      if (state.stored >= STORAGE_CAPACITY) {
        status = "가득 참";
        runtimeState = "blocked";
      } else if (!this.hasInputConnection(data)) {
        status = "벨트 연결 필요";
        runtimeState = "disconnected";
      } else if (state.intakePulse > 0) {
        status = "입고 중";
        runtimeState = "working";
      } else {
        status = state.stored > 0 ? "보관 중" : "입고 대기";
        runtimeState = "idle";
      }
    }
    else if (state.working) {
      status = "가동 중";
      runtimeState = "working";
    }
    else if (state.output.length > 0) {
      status = this.hasOutputConnection(data) ? "출력 정체" : "출력 벨트 연결 필요";
      runtimeState = "blocked";
    }
    else if (data.type !== "miner" && !this.hasInputConnection(data)) {
      status = "입력 벨트 연결 필요";
      runtimeState = "disconnected";
    }
    return {
      id,
      type: data.type,
      status,
      runtimeState,
      recipeName: data.type === "miner"
        ? "철광석 채굴"
        : data.type === "smelter"
          ? "철 주괴 제련"
          : data.type === "assembler"
            ? "조립품 제작"
            : "품목 보관",
      progress: data.type === "storage" ? state.stored / STORAGE_CAPACITY : state.progress,
      inputCount: data.type === "storage" ? state.stored : state.input.length,
      inputCapacity: data.type === "storage" ? STORAGE_CAPACITY : data.type === "assembler" ? 4 : data.type === "smelter" ? 2 : 0,
      outputCount: state.output.length,
      outputCapacity: data.type === "storage" ? STORAGE_CAPACITY : 1,
    };
  }

  update(delta: number) {
    this.clock.advance(Math.min(Math.max(delta, 0), 0.25), (_tick, fixedDelta) => {
      this.step(fixedDelta);
    });
  }

  private step(delta: number) {
    this.updateMachines(delta);
    this.dispatchMachineOutputs();
    this.updateBelts(delta);
  }

  private updateMachines(delta: number) {
    this.structures.forEach((data, id) => {
      if (data.type === "belt") return;
      const state = this.machines.get(id);
      if (!state) return;
      if (data.type === "storage") {
        state.intakePulse = Math.max(0, state.intakePulse - delta / 0.42);
        state.activity = state.intakePulse;
        state.animationTime += delta;
        return;
      }

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
      const inputPort = this.inputPorts.get(cellKey(belt.x, belt.z));
      if (inputPort !== undefined) {
        const machine = this.structures.get(inputPort.machineId);
        if (machine && sameDirection(machinePorts(machine).flow, direction)
          && this.acceptItem(inputPort.machineId, item.type)) {
          this.beltItems.delete(beltId);
          return;
        }
      }

      const next = this.getStructureAt(belt.x + direction.x, belt.z + direction.z);
      if (next?.type === "belt" && !this.beltItems.has(next.id)) {
        this.beltItems.delete(beltId);
        item.progress -= 1;
        item.incoming = direction;
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
    if (machine.type === "storage" && item === "component" && state.stored < STORAGE_CAPACITY) {
      state.stored += 1;
      state.intakePulse = 1;
      return true;
    }
    return false;
  }

  private rebuildPorts() {
    this.inputPorts.clear();
    this.structures.forEach((data) => {
      if (data.type === "belt" || data.type === "miner") return;
      machinePorts(data).inputs.forEach((input, inputIndex) => {
        this.inputPorts.set(cellKey(input.x, input.z), { machineId: data.id, inputIndex });
      });
    });
  }
}
