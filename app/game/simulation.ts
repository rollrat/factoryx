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
import { MergerRouter, SplitterRouter } from "./sim/junction.ts";
import { START_REGISTRY } from "./data/index.ts";
import { getRuntimeRecipe, resolveRuntimeRecipe, type RuntimeRecipe } from "./recipes/runtimeRecipes.ts";
import type { BeltItem, BuildType, Direction, ItemType, MachineState, SelectedInfo, StructureData } from "./types.ts";

const isTransport = (type: BuildType) => type === "belt" || type === "splitter" || type === "merger";

const aggregateItems = (items: readonly ItemType[]) => {
  const counts = new Map<ItemType, number>();
  items.forEach((item) => counts.set(item, (counts.get(item) ?? 0) + 1));
  return [...counts].map(([itemId, amount]) => ({
    itemId,
    name: START_REGISTRY.items.get(itemId)?.name ?? itemId,
    amount,
  }));
};

const hasRecipeInputs = (items: readonly ItemType[], recipe: RuntimeRecipe) =>
  recipe.inputs.every(({ itemId, amount }) => items.filter((item) => item === itemId).length >= amount);

const consumeRecipeInputs = (items: ItemType[], recipe: RuntimeRecipe) => {
  recipe.inputs.forEach(({ itemId, amount }) => {
    for (let removed = 0; removed < amount; removed += 1) {
      const index = items.indexOf(itemId);
      if (index >= 0) items.splice(index, 1);
    }
  });
};

export class FactorySimulation {
  readonly structures = new Map<number, StructureData>();
  readonly occupancy = new Map<string, number>();
  readonly machines = new Map<number, MachineState>();
  readonly beltItems = new Map<number, BeltItem>();

  private readonly clock = new FixedStepClock();
  private readonly splitterRouters = new Map<number, SplitterRouter<ItemType>>();
  private readonly mergerRouters = new Map<number, MergerRouter<ItemType>>();
  private nextItemId = 1;
  private inputPorts = new Map<string, { machineId: number; inputIndex: number }>();

  addStructure(data: StructureData) {
    this.structures.set(data.id, { ...data });
    footprint(data.type, data.x, data.z).forEach((cell) => this.occupancy.set(cell, data.id));
    if (!isTransport(data.type)) {
      const initialRecipe = data.type === "miner"
        ? resolveRuntimeRecipe({ type: "miner", x: data.x, z: data.z })
        : data.type === "assembler"
          ? resolveRuntimeRecipe({ type: "assembler" })
          : data.type === "crusher"
            ? resolveRuntimeRecipe({ type: "crusher" })
          : null;
      this.machines.set(data.id, {
        recipeId: initialRecipe?.id ?? null,
        input: [],
        output: [],
        progress: 0,
        working: false,
        activity: 0,
        animationTime: 0,
        stored: 0,
        storedItems: [],
        intakePulse: 0,
      });
    }
    if (data.type === "splitter") this.splitterRouters.set(data.id, new SplitterRouter<ItemType>());
    if (data.type === "merger") this.mergerRouters.set(data.id, new MergerRouter<ItemType>());
    this.rebuildPorts();
  }

  removeStructure(id: number) {
    const data = this.structures.get(id);
    if (!data) return null;
    footprint(data.type, data.x, data.z).forEach((cell) => this.occupancy.delete(cell));
    this.structures.delete(id);
    this.machines.delete(id);
    this.beltItems.delete(id);
    this.splitterRouters.delete(id);
    this.mergerRouters.delete(id);
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
    if (isTransport(data.type)) return false;
    const ports = machinePorts(data);
    const belt = this.getStructureAt(ports.output.x, ports.output.z);
    return Boolean(belt && isTransport(belt.type) && sameDirection(directionForRotation(belt.rotation), ports.flow));
  }

  hasInputConnection(data: StructureData) {
    if (isTransport(data.type)) return false;
    return this.getInputConnections(data).some(Boolean);
  }

  getInputConnections(data: StructureData) {
    if (isTransport(data.type)) return [];
    const ports = machinePorts(data);
    return ports.inputs.map((input) => {
      const belt = this.getStructureAt(input.x, input.z);
      return Boolean(belt && isTransport(belt.type) && sameDirection(directionForRotation(belt.rotation), ports.flow));
    });
  }

  getStoredComponents() {
    let total = 0;
    this.structures.forEach((data, id) => {
      if (data.type === "storage") {
        total += this.machines.get(id)?.storedItems.filter((item) => item === "iron_plate").length ?? 0;
      }
    });
    return total;
  }

  getSelectedInfo(id: number): SelectedInfo {
    const data = this.structures.get(id);
    if (!data) return null;
    if (isTransport(data.type)) {
      const item = this.beltItems.get(id);
      const jammed = Boolean(item && item.progress >= 0.979);
      return {
        id,
        type: data.type,
        status: jammed ? "출력 막힘" : item ? "운송 중" : "가동 대기",
        runtimeState: jammed ? "blocked" : item ? "working" : "idle",
        recipeName: data.type === "splitter" ? "라운드로빈 분배" : data.type === "merger" ? "공정 병합" : "단일 품목 운송",
        progress: item?.progress ?? 0,
        inputCount: item ? 1 : 0,
        inputCapacity: 1,
        outputCount: jammed ? 1 : 0,
        outputCapacity: 1,
      };
    }
    const state = this.machines.get(id);
    if (!state) return null;
    const recipe = state.recipeId ? getRuntimeRecipe(state.recipeId) : null;
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
      recipeName: recipe?.name ?? (data.type === "storage" ? "품목 보관" : "입력 품목 자동 선택"),
      progress: data.type === "storage" ? state.stored / STORAGE_CAPACITY : state.progress,
      inputCount: data.type === "storage" ? state.stored : state.input.length,
      inputItems: aggregateItems(data.type === "storage" ? state.storedItems : state.input),
      inputCapacity: data.type === "storage" ? STORAGE_CAPACITY : data.type === "crusher" ? 8 : data.type === "assembler" ? 4 : data.type === "smelter" ? 2 : 0,
      outputCount: state.output.length,
      outputItems: aggregateItems(state.output),
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
      if (isTransport(data.type)) return;
      const state = this.machines.get(id);
      if (!state) return;
      if (data.type === "storage") {
        state.intakePulse = Math.max(0, state.intakePulse - delta / 0.42);
        state.activity = state.intakePulse;
        state.animationTime += delta;
        return;
      }

      let recipe = state.recipeId ? getRuntimeRecipe(state.recipeId) : null;
      if (!recipe && data.type === "smelter" && state.input[0]) {
        recipe = resolveRuntimeRecipe({ type: "smelter", inputItemId: state.input[0] });
        state.recipeId = recipe?.id ?? null;
      }

      if (!state.working && state.output.length === 0 && recipe && hasRecipeInputs(state.input, recipe)) {
        consumeRecipeInputs(state.input, recipe);
        state.working = true;
        state.progress = 0;
      }

      if (state.working && recipe) {
        state.progress += delta / recipe.durationSeconds;
        if (state.progress >= 1) {
          recipe.outputs.forEach(({ itemId, amount }) => {
            for (let produced = 0; produced < amount; produced += 1) state.output.push(itemId);
          });
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
      if (isTransport(data.type)) return;
      const state = this.machines.get(id);
      if (!state) return;
      const outputItems = data.type === "storage" ? state.storedItems : state.output;
      if (!outputItems.length) return;
      const ports = machinePorts(data);
      const belt = this.getStructureAt(ports.output.x, ports.output.z);
      if (!belt || !isTransport(belt.type) || this.beltItems.has(belt.id)) return;
      if (!sameDirection(directionForRotation(belt.rotation), ports.flow)) return;
      this.beltItems.set(belt.id, {
        id: this.nextItemId++,
        type: outputItems.shift() as ItemType,
        progress: 0,
      });
      if (data.type === "storage") state.stored = state.storedItems.length;
    });
  }

  private updateBelts(delta: number) {
    const snapshot = Array.from(this.beltItems.entries());
    const mergerCandidates = new Map<number, Array<{ beltId: number; item: BeltItem; portId: string; direction: Direction }>>();
    snapshot.forEach(([beltId, item]) => {
      if (this.beltItems.get(beltId) !== item) return;
      const belt = this.structures.get(beltId);
      if (!belt || !isTransport(belt.type)) {
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
      if (belt.type === "splitter") {
        const left = { x: direction.z, z: -direction.x };
        const right = { x: -direction.z, z: direction.x };
        const directions = [direction, left, right];
        const candidates = directions.map((candidateDirection, index) => {
          const target = this.getStructureAt(belt.x + candidateDirection.x, belt.z + candidateDirection.z);
          return {
            portId: ["forward", "left", "right"][index],
            connected: Boolean(target && isTransport(target.type)
              && sameDirection(directionForRotation(target.rotation), candidateDirection)),
            blocked: !target || !isTransport(target.type) || this.beltItems.has(target.id),
            target,
            direction: candidateDirection,
          };
        });
        const decision = this.splitterRouters.get(belt.id)?.selectOutput(item.type, candidates);
        const chosen = candidates.find((candidate) => candidate.portId === decision?.portId);
        if (chosen?.target && isTransport(chosen.target.type)) {
          this.beltItems.delete(beltId);
          item.progress -= 1;
          item.incoming = chosen.direction;
          this.beltItems.set(chosen.target.id, item);
          return;
        }
        item.progress = 0.98;
        return;
      }
      if (next?.type === "merger" && !this.beltItems.has(next.id)) {
        const candidates = mergerCandidates.get(next.id) ?? [];
        candidates.push({ beltId, item, portId: `${belt.x},${belt.z}`, direction });
        mergerCandidates.set(next.id, candidates);
      } else if (next && isTransport(next.type) && !this.beltItems.has(next.id)) {
        this.beltItems.delete(beltId);
        item.progress -= 1;
        item.incoming = direction;
        this.beltItems.set(next.id, item);
      } else {
        item.progress = 0.98;
      }
    });

    mergerCandidates.forEach((candidates, mergerId) => {
      if (this.beltItems.has(mergerId)) {
        candidates.forEach(({ item }) => { item.progress = 0.98; });
        return;
      }
      const decision = this.mergerRouters.get(mergerId)?.selectInput(candidates.map((candidate) => ({
        portId: candidate.portId,
        connected: true,
        item: candidate.item.type,
      })));
      const chosen = candidates.find((candidate) => candidate.portId === decision?.portId);
      if (!chosen || this.beltItems.get(chosen.beltId) !== chosen.item) {
        candidates.forEach(({ item }) => { item.progress = 0.98; });
        return;
      }
      candidates.forEach(({ item }) => {
        if (item !== chosen.item) item.progress = 0.98;
      });
      this.beltItems.delete(chosen.beltId);
      chosen.item.progress = 0;
      chosen.item.incoming = chosen.direction;
      this.beltItems.set(mergerId, chosen.item);
    });
  }

  private acceptItem(machineId: number, item: ItemType) {
    const machine = this.structures.get(machineId);
    const state = this.machines.get(machineId);
    if (!machine || !state) return false;
    if (machine.type === "smelter" && state.input.length < 2) {
      const recipe = resolveRuntimeRecipe({ type: "smelter", inputItemId: item });
      if (!recipe || (state.recipeId && state.recipeId !== recipe.id
        && (state.input.length > 0 || state.output.length > 0 || state.working))) return false;
      state.recipeId = recipe.id;
      state.input.push(item);
      return true;
    }
    if (machine.type === "assembler" && item === "iron_ingot" && state.input.length < 4) {
      state.recipeId = "form_iron_plate";
      state.input.push(item);
      return true;
    }
    if (machine.type === "crusher" && item === "limestone" && state.input.length < 8) {
      state.recipeId = "crush_construction_block";
      state.input.push(item);
      return true;
    }
    if (machine.type === "storage" && state.stored < STORAGE_CAPACITY) {
      state.storedItems.push(item);
      state.stored += 1;
      state.intakePulse = 1;
      return true;
    }
    return false;
  }

  private rebuildPorts() {
    this.inputPorts.clear();
    this.structures.forEach((data) => {
      if (isTransport(data.type) || data.type === "miner") return;
      machinePorts(data).inputs.forEach((input, inputIndex) => {
        this.inputPorts.set(cellKey(input.x, input.z), { machineId: data.id, inputIndex });
      });
    });
  }
}
