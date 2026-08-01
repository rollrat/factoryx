import type {
  BuildingDefinition,
  ItemId,
  PortDefinition,
  UnlockId,
} from "../domain/types.ts";

const ROTATIONS = [0, 1, 2, 3] as const;

const SOLID_ITEMS: readonly ItemId[] = [
  "iron_ore", "copper_ore", "limestone", "coal", "quartz", "bauxite", "tungsten_ore",
  "iron_ingot", "copper_ingot", "iron_plate", "iron_rod", "construction_block", "fastener_pack",
  "copper_wire", "steel_billet", "gear_set", "electromagnetic_coil", "industrial_motor", "industrial_frame",
  "basic_control_circuit", "automation_core", "polymer_resin", "insulation_sheet", "refined_quartz",
  "insulated_board", "advanced_control_board", "optical_sensor", "alumina", "carbon_electrode",
  "aluminum_ingot", "lightweight_case", "steel_beam", "industrial_power_cell", "precision_actuator",
  "lightweight_structural_shell", "tungsten_ingot", "tungsten_component", "thermal_control_module",
  "high_density_power_cell", "colony_seed_ax17",
];

const FLUID_ITEMS: readonly ItemId[] = ["crude_oil", "fuel_gas"];

const port = (
  id: string,
  direction: PortDefinition["direction"],
  medium: PortDefinition["medium"],
  connectorProfile: PortDefinition["connectorProfile"],
  connectionCell: Readonly<{ x: number; z: number }>,
  localPosition: Readonly<{ x: number; y: number; z: number }>,
  localFacing: Readonly<{ x: number; z: number }>,
  acceptedItemIds: readonly ItemId[] = [],
  deliverySlotId?: string,
): PortDefinition => ({
  id,
  direction,
  medium,
  connectorProfile,
  connectionCell,
  localPosition,
  localFacing,
  bufferSlots: medium === "solid" ? 2 : 0,
  acceptedItemIds,
  ...(deliverySlotId ? { deliverySlotId } : {}),
});

const solid = (
  id: string,
  direction: PortDefinition["direction"],
  x: number,
  z: number,
  localX: number,
  localZ: number,
  facingX: number,
  accepted: readonly ItemId[],
  deliverySlotId?: string,
) => port(id, direction, "solid", "belt_standard", { x, z }, { x: localX, y: 0.36, z: localZ }, { x: facingX, z: 0 }, accepted, deliverySlotId);

const fluid = (
  id: string,
  direction: PortDefinition["direction"],
  x: number,
  z: number,
  localX: number,
  localZ: number,
  facingX: number,
  accepted: readonly ItemId[],
) => port(id, direction, "fluid", "pipe_mk1", { x, z }, { x: localX, y: 0.5, z: localZ }, { x: facingX, z: 0 }, accepted);

const power = (
  id: string,
  direction: PortDefinition["direction"],
  profile: "power_local" | "power_high_voltage",
  x: number,
  z: number,
  localX: number,
  localZ: number,
  facingX: number,
) => port(id, direction, "power", profile, { x, z }, { x: localX, y: 0.8, z: localZ }, { x: facingX, z: 0 });

const straightSolidPorts = (acceptedIn: readonly ItemId[], acceptedOut: readonly ItemId[], sizeX = 2) => [
  solid("solid_in", "input", -1, 0, -sizeX / 2, -0.5, -1, acceptedIn),
  solid("solid_out", "output", sizeX, 0, sizeX / 2, -0.5, 1, acceptedOut),
] as const;

const consumerPower = (sizeX: number, z = 1) => power("power_in", "input", "power_local", sizeX, z, sizeX / 2, z - 0.5, 1);

const cost = (...entries: ReadonlyArray<readonly [ItemId, number]>) =>
  entries.map(([itemId, amount]) => ({ itemId, amount }));

const POWER_LOADS: Readonly<Record<string, Readonly<{ activeMW: number; idleMW: number }>>> = {
  vein_miner: { activeMW: 4, idleMW: 0.2 },
  fluid_extractor: { activeMW: 6, idleMW: 0.2 },
  crusher: { activeMW: 6, idleMW: 0.2 },
  arc_smelter: { activeMW: 6, idleMW: 0.2 },
  alloy_furnace: { activeMW: 12, idleMW: 0.3 },
  electrolytic_reducer: { activeMW: 24, idleMW: 0.5 },
  fractionation_refinery: { activeMW: 18, idleMW: 0.5 },
  hydraulic_former: { activeMW: 7, idleMW: 0.2 },
  industrial_winder: { activeMW: 6, idleMW: 0.2 },
  circuit_printer: { activeMW: 10, idleMW: 0.3 },
  precision_assembler: { activeMW: 10, idleMW: 0.3 },
  heavy_manufacturer: { activeMW: 24, idleMW: 0.5 },
  industrial_storage: { activeMW: 2, idleMW: 0.1 },
  pipe_pump: { activeMW: 2, idleMW: 0.05 },
};

const OPERATIONAL_SPECS: Readonly<Record<string, Partial<BuildingDefinition>>> = {
  conveyor_mk1: { transportPolicy: { throughputPerMinute: 60 } },
  conveyor_mk2: { transportPolicy: { throughputPerMinute: 120 } },
  conveyor_mk3: { transportPolicy: { throughputPerMinute: 240 } },
  fluid_extractor: { fluidStoragePolicy: { capacityM3: 100, throughputM3PerMinute: 60, locksFluidType: true } },
  fractionation_refinery: { fluidStoragePolicy: { capacityM3: 200, throughputM3PerMinute: 60, locksFluidType: true } },
  pipe_mk1: { transportPolicy: { throughputPerMinute: 60 }, fluidStoragePolicy: { capacityM3: 4, throughputM3PerMinute: 60, locksFluidType: true } },
  pipe_t_junction: { transportPolicy: { throughputPerMinute: 60 }, fluidStoragePolicy: { capacityM3: 8, throughputM3PerMinute: 60, locksFluidType: true } },
  pipe_pump: { transportPolicy: { throughputPerMinute: 60 }, fluidStoragePolicy: { capacityM3: 8, throughputM3PerMinute: 60, locksFluidType: true } },
  fluid_tank: { fluidStoragePolicy: { capacityM3: 1_000, throughputM3PerMinute: 60, locksFluidType: true } },
  emergency_flare: { fluidStoragePolicy: { capacityM3: 100, throughputM3PerMinute: 60, locksFluidType: true } },
  solid_fuel_generator: {
    generatorPolicy: { capacityMW: 72, fuelItemId: "coal", fuelRatePerMinute: 12, minimumLoadRatio: 0.25, dispatchPriority: 3 },
  },
  combined_fuel_turbine: {
    generatorPolicy: { capacityMW: 240, fuelItemId: "fuel_gas", fuelRatePerMinute: 20, minimumLoadRatio: 0, dispatchPriority: 2 },
    fluidStoragePolicy: { capacityM3: 100, throughputM3PerMinute: 60, locksFluidType: true },
  },
  high_density_thermal_plant: {
    generatorPolicy: { capacityMW: 720, fuelItemId: "high_density_power_cell", fuelRatePerMinute: 1, minimumLoadRatio: 0, dispatchPriority: 4 },
  },
  distribution_pole_mk1: { distributionPolicy: { radiusTiles: 3.5, maxConsumers: 6, maxCableConnections: 2 } },
  distribution_pole_mk2: { distributionPolicy: { radiusTiles: 5, maxConsumers: 12, maxCableConnections: 4 } },
  high_voltage_tower: { distributionPolicy: { maxCableConnections: 2 } },
  substation: { distributionPolicy: { maxCableConnections: 6 } },
  power_breaker: { distributionPolicy: { maxCableConnections: 2 } },
  priority_switchboard: { distributionPolicy: { maxCableConnections: 5 } },
  industrial_accumulator: {
    powerStoragePolicy: { capacityMWh: 4, maxChargeMW: 24, maxDischargeMW: 48 },
    activeMW: 0.1,
    idleMW: 0.1,
  },
};

const STANDARD_BUFFER_POLICY = {
  reserveInputsAtomically: true,
  reserveAllOutputsBeforeStart: true,
  returnContentsOnRecipeChange: true,
  returnContentsOnDemolish: true,
} as const;

const building = (
  id: string,
  name: string,
  unlockId: UnlockId,
  footprint: Readonly<{ x: number; z: number }>,
  ports: readonly PortDefinition[],
  recipeIds: readonly string[],
  buildCost: readonly { itemId: ItemId; amount: number }[],
  storageSlots?: number,
): BuildingDefinition => ({
  id,
  name,
  unlockId,
  placementMode: "buildable",
  footprint,
  allowedRotations: ROTATIONS,
  ports,
  recipeIds,
  ...(recipeIds.length > 0 ? { processingSpeed: 1, bufferPolicy: STANDARD_BUFFER_POLICY } : {}),
  ...(POWER_LOADS[id] ?? {}),
  ...(OPERATIONAL_SPECS[id] ?? {}),
  buildCost,
  ...(storageSlots === undefined ? {} : { storageSlots }),
  ...(storageSlots === undefined ? {} : {
    storagePolicy: {
      slotCount: storageSlots,
      lockToSingleItem: true,
      supportsInputFilter: true,
      supportsOutputFilter: true,
      defaultRoutingPolicy: "pass_through",
    } as const,
  }),
  modelKey: id,
  animationKey: `${id}_operation`,
});

export const START_BUILDINGS = [
  // 채취 및 생산 설비
  building(
    "vein_miner", "광맥 채굴기", "start", { x: 2, z: 2 },
    [solid("solid_out", "output", 2, 0, 1, -0.5, 1, ["iron_ore", "copper_ore", "limestone", "coal", "quartz", "bauxite", "tungsten_ore"]), consumerPower(2)],
    ["mine_iron_ore", "mine_copper_ore", "mine_limestone", "mine_coal", "mine_quartz", "mine_bauxite", "mine_tungsten_ore"],
    cost(["iron_plate", 12], ["iron_rod", 8], ["fastener_pack", 4]),
  ),
  building(
    "fluid_extractor", "유체 추출기", "phase_3_complete", { x: 2, z: 2 },
    [fluid("fluid_out", "output", 2, 0, 1, -0.5, 1, ["crude_oil"]), consumerPower(2)],
    ["extract_crude_oil"],
    cost(["steel_billet", 30], ["industrial_frame", 6], ["industrial_motor", 4], ["basic_control_circuit", 4]),
  ),
  building(
    "crusher", "파쇄기", "start", { x: 2, z: 2 },
    [...straightSolidPorts(["limestone", "quartz", "bauxite"], ["construction_block", "refined_quartz", "alumina"]), consumerPower(2)],
    ["crush_construction_block", "crush_refined_quartz", "crush_alumina"],
    cost(["iron_plate", 12], ["iron_rod", 8], ["fastener_pack", 4]),
  ),
  building(
    "arc_smelter", "아크 제련기", "start", { x: 2, z: 2 },
    [...straightSolidPorts(["iron_ore", "copper_ore", "tungsten_ore"], ["iron_ingot", "copper_ingot", "tungsten_ingot"]), consumerPower(2)],
    ["smelt_iron_ingot", "smelt_copper_ingot", "smelt_tungsten_ingot"],
    cost(["iron_plate", 16], ["construction_block", 8], ["fastener_pack", 6]),
  ),
  building(
    "alloy_furnace", "합금로", "phase_1_complete", { x: 3, z: 3 },
    [
      solid("iron_in", "input", -1, 0, -1.5, -1, -1, ["iron_ingot"]),
      solid("carbon_in", "input", -1, 2, -1.5, 1, -1, ["coal"]),
      solid("alloy_out", "output", 3, 1, 1.5, 0, 1, ["steel_billet"]),
      consumerPower(3, 2),
    ],
    ["alloy_steel_billet"],
    cost(["iron_plate", 24], ["construction_block", 24], ["fastener_pack", 10]),
  ),
  building(
    "electrolytic_reducer", "전해 환원기", "chemistry_stable", { x: 3, z: 3 },
    [
      solid("alumina_in", "input", -1, 0, -1.5, -1, -1, ["alumina"]),
      solid("electrode_in", "input", -1, 2, -1.5, 1, -1, ["carbon_electrode"]),
      solid("metal_out", "output", 3, 1, 1.5, 0, 1, ["aluminum_ingot"]),
      consumerPower(3, 2),
    ],
    ["reduce_aluminum_ingot"],
    cost(["steel_billet", 60], ["industrial_frame", 12], ["industrial_motor", 6], ["advanced_control_board", 4]),
  ),
  building(
    "fractionation_refinery", "분해 정제탑", "phase_3_complete", { x: 3, z: 3 },
    [
      fluid("crude_in", "input", -1, 1, -1.5, 0, -1, ["crude_oil"]),
      solid("resin_out", "output", 3, 0, 1.5, -1, 1, ["polymer_resin"]),
      fluid("gas_out", "output", 3, 2, 1.5, 1, 1, ["fuel_gas"]),
      consumerPower(3, 2),
    ],
    ["refine_crude_oil"],
    cost(["steel_billet", 50], ["industrial_frame", 10], ["industrial_motor", 6], ["basic_control_circuit", 8]),
  ),
  building(
    "hydraulic_former", "유압 성형기", "start", { x: 2, z: 2 },
    [...straightSolidPorts(
      ["iron_ingot", "iron_rod", "polymer_resin", "coal", "aluminum_ingot", "steel_billet", "tungsten_ingot"],
      ["iron_plate", "iron_rod", "fastener_pack", "insulation_sheet", "carbon_electrode", "lightweight_case", "steel_beam", "tungsten_component"],
    ), consumerPower(2)],
    ["form_iron_plate", "form_iron_rod", "form_fastener_pack", "form_insulation_sheet", "form_carbon_electrode", "form_lightweight_case", "form_steel_beam", "form_tungsten_component"],
    cost(["iron_plate", 12], ["construction_block", 8], ["fastener_pack", 6]),
  ),
  building(
    "industrial_winder", "산업 권선기", "phase_1_complete", { x: 2, z: 2 },
    [...straightSolidPorts(["copper_ingot"], ["copper_wire"]), consumerPower(2)],
    ["wind_copper_wire"],
    cost(["iron_plate", 20], ["iron_rod", 12], ["fastener_pack", 8]),
  ),
  building(
    "circuit_printer", "회로 인쇄기", "phase_2_complete", { x: 3, z: 2 },
    [
      solid("primary_in", "input", -1, 0, -1.5, -0.5, -1, ["quartz", "refined_quartz", "basic_control_circuit"]),
      solid("support_in", "input", -1, 1, -1.5, 0.5, -1, ["copper_wire", "insulation_sheet", "insulated_board", "basic_control_circuit"]),
      solid("product_out", "output", 3, 0, 1.5, -0.5, 1, ["basic_control_circuit", "insulated_board", "advanced_control_board", "optical_sensor"]),
      consumerPower(3),
    ],
    ["print_basic_control_circuit", "print_insulated_board", "print_advanced_control_board", "print_optical_sensor"],
    cost(["steel_billet", 16], ["copper_wire", 40], ["electromagnetic_coil", 8], ["industrial_frame", 2]),
  ),
  building(
    "precision_assembler", "정밀 조립기", "phase_1_complete", { x: 3, z: 2 },
    [
      solid("input_0", "input", -1, 0, -1.5, -0.5, -1, ["iron_plate", "copper_wire", "gear_set", "steel_billet"]),
      solid("input_1", "input", -1, 1, -1.5, 0.5, -1, ["iron_rod", "electromagnetic_coil", "iron_plate"]),
      solid("product_out", "output", 3, 0, 1.5, -0.5, 1, ["gear_set", "electromagnetic_coil", "industrial_motor", "industrial_frame"]),
      consumerPower(3),
    ],
    ["assemble_gear_set", "assemble_electromagnetic_coil", "assemble_industrial_motor", "assemble_industrial_frame"],
    cost(["iron_plate", 24], ["construction_block", 16], ["fastener_pack", 12]),
  ),
  building(
    "heavy_manufacturer", "중량 제작소", "phase_2_complete", { x: 3, z: 3 },
    [
      solid("input_0", "input", -1, 0, -1.5, -1, -1, ["industrial_motor", "lightweight_case", "industrial_frame", "electromagnetic_coil", "industrial_power_cell"]),
      solid("input_1", "input", -1, 2, -1.5, 1, -1, ["basic_control_circuit", "carbon_electrode", "steel_beam", "advanced_control_board", "lightweight_case"]),
      port("input_2", "input", "solid", "belt_standard", { x: 0, z: -1 }, { x: -1, y: 0.36, z: -1.5 }, { x: 0, z: -1 }, ["industrial_frame", "insulation_sheet", "lightweight_case", "tungsten_component"]),
      port("input_3", "input", "solid", "belt_standard", { x: 2, z: -1 }, { x: 1, y: 0.36, z: -1.5 }, { x: 0, z: -1 }, ["optical_sensor", "insulation_sheet", "tungsten_component"]),
      solid("product_out", "output", 3, 1, 1.5, 0, 1, ["automation_core", "industrial_power_cell", "precision_actuator", "lightweight_structural_shell", "thermal_control_module", "high_density_power_cell"]),
      consumerPower(3, 2),
    ],
    ["manufacture_automation_core", "manufacture_industrial_power_cell", "manufacture_precision_actuator", "manufacture_lightweight_structural_shell", "manufacture_thermal_control_module", "manufacture_high_density_power_cell"],
    cost(["steel_billet", 30], ["iron_plate", 40], ["electromagnetic_coil", 12], ["industrial_frame", 6]),
  ),

  // 고체 물류
  building("conveyor_mk1", "컨베이어 Mk.1", "start", { x: 1, z: 1 }, straightSolidPorts(SOLID_ITEMS, SOLID_ITEMS, 1), [], cost(["iron_plate", 1])),
  building("conveyor_mk2", "컨베이어 Mk.2", "phase_1_complete", { x: 1, z: 1 }, straightSolidPorts(SOLID_ITEMS, SOLID_ITEMS, 1), [], cost(["iron_plate", 1], ["fastener_pack", 1])),
  building("conveyor_mk3", "컨베이어 Mk.3", "phase_3_complete", { x: 1, z: 1 }, straightSolidPorts(SOLID_ITEMS, SOLID_ITEMS, 1), [], cost(["steel_billet", 1], ["industrial_motor", 1])),
  building(
    "splitter", "분배기", "start", { x: 2, z: 2 },
    [
      solid("in", "input", -1, 0, -1, -0.5, -1, SOLID_ITEMS),
      solid("out_a", "output", 2, 0, 1, -0.5, 1, SOLID_ITEMS),
      solid("out_b", "output", 2, 1, 1, 0.5, 1, SOLID_ITEMS),
    ], [], cost(["iron_plate", 4], ["iron_rod", 2]),
  ),
  building(
    "merger", "병합기", "start", { x: 2, z: 2 },
    [
      solid("in_a", "input", -1, 0, -1, -0.5, -1, SOLID_ITEMS),
      solid("in_b", "input", -1, 1, -1, 0.5, -1, SOLID_ITEMS),
      solid("out", "output", 2, 0, 1, -0.5, 1, SOLID_ITEMS),
    ], [], cost(["iron_plate", 4], ["iron_rod", 2]),
  ),
  building("small_storage", "소형 저장고", "start", { x: 2, z: 2 }, straightSolidPorts(SOLID_ITEMS, SOLID_ITEMS), [], cost(["iron_plate", 20], ["construction_block", 8], ["fastener_pack", 8]), 4),
  building("industrial_storage", "산업 저장고", "phase_2_complete", { x: 3, z: 3 }, [...straightSolidPorts(SOLID_ITEMS, SOLID_ITEMS, 3), consumerPower(3, 2)], [], cost(["steel_billet", 24], ["iron_plate", 32], ["industrial_frame", 4]), 24),

  // 지형 대응 기반 시설
  {
    ...building("foundation_2m", "산업 기초", "start", { x: 2, z: 2 }, [], [], cost(["construction_block", 4], ["iron_plate", 2])),
    terrainPolicy: { role: "foundation", stabilizesSurface: true, allowedOnRestrictedSurface: true },
  },
  {
    ...building("access_ramp", "접근 램프", "phase_1_complete", { x: 2, z: 3 }, [], [], cost(["construction_block", 6], ["iron_plate", 4])),
    terrainPolicy: { role: "ramp", allowedOnRestrictedSurface: true, elevationStep: 2 },
  },
  {
    ...building("short_bridge", "단경간 교량", "phase_1_complete", { x: 2, z: 4 }, [], [], cost(["steel_billet", 8], ["construction_block", 8])),
    terrainPolicy: { role: "bridge", allowedOnRestrictedSurface: true, elevationStep: 2 },
  },
  {
    ...building("conveyor_lift", "컨베이어 리프트", "phase_1_complete", { x: 1, z: 1 }, [
      port("lower_in", "input", "solid", "belt_standard", { x: 0, z: -1 }, { x: 0, y: 0.45, z: -0.5 }, { x: 0, z: -1 }, SOLID_ITEMS),
      port("upper_out", "output", "solid", "belt_standard", { x: 0, z: 1 }, { x: 0, y: 3.45, z: 0.5 }, { x: 0, z: 1 }, SOLID_ITEMS),
    ], [], cost(["steel_billet", 4], ["iron_plate", 4], ["fastener_pack", 2])),
    terrainPolicy: { role: "conveyor_lift", allowedOnRestrictedSurface: true, elevationStep: 3 },
    transportPolicy: { throughputPerMinute: 52, maxSegmentLengthTiles: 1 },
  },
  {
    ...building("solid_wall_socket", "벨트 벽 관통 소켓", "phase_2_complete", { x: 1, z: 1 }, straightSolidPorts(SOLID_ITEMS, SOLID_ITEMS, 1), [], cost(["steel_billet", 3], ["fastener_pack", 2])),
    terrainPolicy: { role: "wall_socket", allowedOnRestrictedSurface: true },
    transportPolicy: { throughputPerMinute: 52, maxSegmentLengthTiles: 1 },
  },
  {
    ...building("shaft_logistics_socket", "대형 갱도 물류 소켓", "thermal_verified", { x: 3, z: 3 }, [
      ...straightSolidPorts(SOLID_ITEMS, SOLID_ITEMS, 3),
      power("shaft_power", "bidirectional", "power_high_voltage", 3, 2, 1.5, 1, 1),
    ], [], cost(["steel_beam", 24], ["industrial_frame", 8], ["advanced_control_board", 4])),
    terrainPolicy: { role: "shaft_socket", allowedOnRestrictedSurface: true, connectsStrata: true, elevationStep: 12 },
    transportPolicy: { throughputPerMinute: 120, maxSegmentLengthTiles: 1 },
  },

  // 유체 물류
  building("fluid_tank", "유체 탱크", "phase_3_complete", { x: 2, z: 2 }, [fluid("fluid_in", "input", -1, 0, -1, -0.5, -1, FLUID_ITEMS), fluid("fluid_out", "output", 2, 1, 1, 0.5, 1, FLUID_ITEMS)], [], cost(["steel_billet", 20], ["iron_plate", 20], ["fastener_pack", 8])),
  building("pipe_mk1", "파이프 Mk.1", "phase_3_complete", { x: 1, z: 1 }, [fluid("pipe_in", "bidirectional", -1, 0, -0.5, 0, -1, FLUID_ITEMS), fluid("pipe_out", "bidirectional", 1, 0, 0.5, 0, 1, FLUID_ITEMS)], [], cost(["steel_billet", 1])),
  building("pipe_t_junction", "파이프 T 접합부", "phase_3_complete", { x: 1, z: 1 }, [fluid("pipe_a", "bidirectional", -1, 0, -0.5, 0, -1, FLUID_ITEMS), fluid("pipe_b", "bidirectional", 1, 0, 0.5, 0, 1, FLUID_ITEMS), port("pipe_c", "bidirectional", "fluid", "pipe_mk1", { x: 0, z: 1 }, { x: 0, y: 0.5, z: 0.5 }, { x: 0, z: 1 }, FLUID_ITEMS)], [], cost(["steel_billet", 3], ["fastener_pack", 2])),
  building("pipe_pump", "파이프 펌프", "phase_3_complete", { x: 1, z: 1 }, [fluid("fluid_in", "input", -1, 0, -0.5, 0, -1, FLUID_ITEMS), fluid("fluid_out", "output", 1, 0, 0.5, 0, 1, FLUID_ITEMS), consumerPower(1)], [], cost(["steel_billet", 8], ["industrial_motor", 1], ["basic_control_circuit", 1])),
  {
    ...building("pipe_riser", "파이프 라이저", "phase_3_complete", { x: 1, z: 1 }, [
      port("lower_pipe", "bidirectional", "fluid", "pipe_mk1", { x: 0, z: -1 }, { x: 0, y: 0.5, z: -0.5 }, { x: 0, z: -1 }, FLUID_ITEMS),
      port("upper_pipe", "bidirectional", "fluid", "pipe_mk1", { x: 0, z: 1 }, { x: 0, y: 3.5, z: 0.5 }, { x: 0, z: 1 }, FLUID_ITEMS),
    ], [], cost(["steel_billet", 5], ["fastener_pack", 2])),
    terrainPolicy: { role: "pipe_riser", allowedOnRestrictedSurface: true, elevationStep: 3 },
    fluidStoragePolicy: { capacityM3: 8, throughputM3PerMinute: 60, locksFluidType: true },
  },
  {
    ...building("pipe_wall_socket", "파이프 벽 관통 소켓", "phase_3_complete", { x: 1, z: 1 }, [
      fluid("pipe_in", "bidirectional", -1, 0, -0.5, 0, -1, FLUID_ITEMS),
      fluid("pipe_out", "bidirectional", 1, 0, 0.5, 0, 1, FLUID_ITEMS),
    ], [], cost(["steel_billet", 4], ["fastener_pack", 2])),
    terrainPolicy: { role: "wall_socket", allowedOnRestrictedSurface: true },
    fluidStoragePolicy: { capacityM3: 8, throughputM3PerMinute: 60, locksFluidType: true },
  },
  building("emergency_flare", "비상 플레어", "phase_3_complete", { x: 2, z: 2 }, [fluid("gas_in", "input", -1, 0, -1, -0.5, -1, ["fuel_gas"]), consumerPower(2)], [], cost(["steel_billet", 16], ["industrial_frame", 2], ["basic_control_circuit", 1])),
  {
    ...building("hazard_stabilizer", "지열 안정화 설비", "phase_3_complete", { x: 2, z: 2 }, [consumerPower(2)], [], cost(["steel_billet", 18], ["industrial_frame", 4], ["basic_control_circuit", 3])),
    terrainPolicy: { role: "hazard_stabilizer", allowedOnRestrictedSurface: true },
  },

  // 발전 및 송배전
  {
    id: "field_power_core",
    name: "현장 전력 코어",
    unlockId: "start",
    placementMode: "preplaced_unique",
    footprint: { x: 2, z: 2 },
    allowedRotations: [0],
    ports: [power("power_out", "output", "power_local", 2, 0, 1, -0.5, 1)],
    recipeIds: [],
    buildCost: [],
    modelKey: "field_power_core",
    animationKey: "field_power_core_operation",
    generatorPolicy: { capacityMW: 24, minimumLoadRatio: 0, dispatchPriority: 1 },
    preplacedPolicy: { worldAnchor: { x: 0, z: 0 }, fixedRotation: 0, canBuild: false, canClone: false, canDemolish: false },
  },
  building("solid_fuel_generator", "고체연료 발전기", "phase_1_complete", { x: 3, z: 3 }, [solid("fuel_in", "input", -1, 1, -1.5, 0, -1, ["coal"]), power("power_out", "output", "power_local", 3, 1, 1.5, 0, 1)], [], cost(["iron_plate", 40], ["construction_block", 32], ["fastener_pack", 16])),
  building("combined_fuel_turbine", "복합 연료 터빈", "phase_3_complete", { x: 4, z: 3 }, [fluid("fuel_in", "input", -1, 1, -2, 0, -1, ["fuel_gas"]), power("power_out", "output", "power_high_voltage", 4, 1, 2, 0, 1)], [], cost(["steel_billet", 60], ["industrial_frame", 12], ["industrial_motor", 8], ["basic_control_circuit", 8])),
  building("high_density_thermal_plant", "고밀도 열 발전소", "thermal_verified", { x: 5, z: 5 }, [solid("cell_in", "input", -1, 2, -2.5, 0, -1, ["high_density_power_cell"]), power("power_out", "output", "power_high_voltage", 5, 2, 2.5, 0, 1)], [], cost(["steel_beam", 80], ["lightweight_case", 60], ["advanced_control_board", 20], ["industrial_power_cell", 12], ["automation_core", 8])),
  building("distribution_pole_mk1", "배전 기둥 Mk.1", "start", { x: 1, z: 1 }, [power("grid_a", "bidirectional", "power_local", -1, 0, -0.5, 0, -1), power("grid_b", "bidirectional", "power_local", 1, 0, 0.5, 0, 1)], [], cost(["iron_plate", 4], ["iron_rod", 4], ["fastener_pack", 2])),
  building("distribution_pole_mk2", "배전 기둥 Mk.2", "phase_2_complete", { x: 1, z: 1 }, [
    power("grid_a", "bidirectional", "power_local", -1, 0, -0.5, 0, -1),
    power("grid_b", "bidirectional", "power_local", 1, 0, 0.5, 0, 1),
    port("grid_c", "bidirectional", "power", "power_local", { x: 0, z: -1 }, { x: 0, y: 0.8, z: -0.5 }, { x: 0, z: -1 }),
    port("grid_d", "bidirectional", "power", "power_local", { x: 0, z: 1 }, { x: 0, y: 0.8, z: 0.5 }, { x: 0, z: 1 }),
  ], [], cost(["steel_billet", 8], ["copper_wire", 12], ["electromagnetic_coil", 2])),
  building("high_voltage_tower", "고압 송전탑", "phase_2_complete", { x: 2, z: 2 }, [power("high_voltage_a", "bidirectional", "power_high_voltage", -1, 0, -1, -0.5, -1), power("high_voltage_b", "bidirectional", "power_high_voltage", 2, 0, 1, -0.5, 1)], [], cost(["steel_billet", 20], ["copper_wire", 24], ["industrial_frame", 2])),
  building("substation", "변전소", "phase_2_complete", { x: 3, z: 3 }, [power("high_voltage_in", "input", "power_high_voltage", -1, 1, -1.5, 0, -1), power("local_out", "output", "power_local", 3, 1, 1.5, 0, 1)], [], cost(["steel_billet", 24], ["copper_wire", 32], ["electromagnetic_coil", 6], ["industrial_frame", 4])),
  building("power_breaker", "전력 차단기", "phase_2_complete", { x: 1, z: 2 }, [power("grid_in", "input", "power_local", -1, 0, -0.5, -0.5, -1), power("grid_out", "output", "power_local", 1, 0, 0.5, -0.5, 1)], [], cost(["steel_billet", 8], ["copper_wire", 12], ["basic_control_circuit", 2])),
  building("priority_switchboard", "우선순위 분전반", "phase_2_complete", { x: 2, z: 2 }, [power("grid_in", "input", "power_local", -1, 0, -1, -0.5, -1), power("priority_1", "output", "power_local", 2, 0, 1, -0.75, 1), power("priority_2", "output", "power_local", 2, 1, 1, -0.25, 1), power("priority_3", "output", "power_local", 2, 1, 1, 0.25, 1), power("priority_4", "output", "power_local", 2, 1, 1, 0.75, 1)], [], cost(["steel_billet", 12], ["copper_wire", 20], ["basic_control_circuit", 4])),
  building("industrial_accumulator", "산업 축전기", "phase_2_complete", { x: 2, z: 2 }, [power("grid", "bidirectional", "power_local", 2, 0, 1, -0.5, 1)], [], cost(["steel_billet", 24], ["copper_wire", 24], ["electromagnetic_coil", 8], ["industrial_frame", 2])),

  // 중앙 프로젝트 도크: 기존 1단계 포트 ID는 런타임 저장 호환성을 위해 유지한다.
  {
    id: "project_dock",
    name: "개척 프로젝트 도크",
    unlockId: "start",
    placementMode: "preplaced_unique",
    footprint: { x: 5, z: 5 },
    allowedRotations: [0],
    ports: [
      solid("phase1_plate_in", "input", -1, 1, -2.5, -1, -1, ["iron_plate", "steel_billet", "automation_core", "polymer_resin", "advanced_control_board", "lightweight_structural_shell"], "solid_0"),
      solid("phase1_block_in", "input", -1, 3, -2.5, 1, -1, ["construction_block", "copper_wire", "industrial_power_cell"], "solid_1"),
      solid("phase1_fastener_in", "input", 5, 1, 2.5, -1, 1, ["fastener_pack", "electromagnetic_coil", "precision_actuator"], "solid_2"),
      solid("reserved_solid_in_1", "input", 5, 3, 2.5, 1, 1, ["industrial_frame", "thermal_control_module"], "solid_3"),
      port("reserved_solid_in_2", "input", "solid", "belt_standard", { x: 2, z: 5 }, { x: 0, y: 0.36, z: 2.5 }, { x: 0, z: 1 }, ["lightweight_structural_shell", "automation_core"], "solid_4"),
      port("fluid_in", "input", "fluid", "pipe_mk1", { x: 1, z: -1 }, { x: -1, y: 0.5, z: -2.5 }, { x: 0, z: -1 }, ["fuel_gas"], "fluid_0"),
      port("power_in", "input", "power", "power_local", { x: 3, z: -1 }, { x: 1, y: 0.8, z: -2.5 }, { x: 0, z: -1 }),
    ],
    recipeIds: [],
    activeMW: 32,
    idleMW: 2,
    fluidStoragePolicy: { capacityM3: 100, throughputM3PerMinute: 60, locksFluidType: true },
    buildCost: [],
    modelKey: "project_dock",
    animationKey: "project_dock_operation",
    preplacedPolicy: { worldAnchor: { x: 6, z: 6 }, fixedRotation: 0, canBuild: false, canClone: false, canDemolish: false },
  },
] as const satisfies readonly BuildingDefinition[];
