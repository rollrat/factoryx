import type { ItemDefinition } from "../domain/types.ts";

type SolidGeometryType =
  | "ore_chunk"
  | "crystal_cluster"
  | "ingot"
  | "plate"
  | "rod_bundle"
  | "block"
  | "parts_pack"
  | "wire_coil"
  | "billet"
  | "gear_set"
  | "coil"
  | "motor"
  | "frame"
  | "circuit_board"
  | "core"
  | "resin_pellet"
  | "sheet"
  | "powder"
  | "sensor"
  | "electrode"
  | "case"
  | "beam"
  | "power_cell"
  | "actuator"
  | "shell"
  | "component"
  | "module"
  | "seed";

type CompleteItemDefinition = ItemDefinition & Readonly<{
  defaultColor: `#${string}`;
}> & (
  | Readonly<{ medium: "solid"; unit: "item"; geometryType: SolidGeometryType }>
  | Readonly<{ medium: "fluid"; unit: "m3"; geometryType: "fluid" }>
);

export const START_ITEMS = [
  // 천연자원
  { id: "iron_ore", name: "철광석", category: "resource", medium: "solid", unit: "item", defaultColor: "#647584", geometryType: "ore_chunk", unlockId: "start", stackSize: 100, modelKey: "ore_iron" },
  { id: "copper_ore", name: "구리광석", category: "resource", medium: "solid", unit: "item", defaultColor: "#B9683F", geometryType: "ore_chunk", unlockId: "start", stackSize: 100, modelKey: "ore_copper" },
  { id: "limestone", name: "석회암", category: "resource", medium: "solid", unit: "item", defaultColor: "#D8D1B8", geometryType: "ore_chunk", unlockId: "start", stackSize: 100, modelKey: "ore_limestone" },
  { id: "coal", name: "석탄", category: "resource", medium: "solid", unit: "item", defaultColor: "#25282C", geometryType: "ore_chunk", unlockId: "phase_1_complete", stackSize: 100, modelKey: "ore_coal" },
  { id: "quartz", name: "석영", category: "resource", medium: "solid", unit: "item", defaultColor: "#BFC7E8", geometryType: "crystal_cluster", unlockId: "phase_2_complete", stackSize: 100, modelKey: "ore_quartz" },
  { id: "crude_oil", name: "원유", category: "fluid", medium: "fluid", unit: "m3", defaultColor: "#171719", geometryType: "fluid", unlockId: "phase_3_complete", stackSize: 100, modelKey: "fluid_crude_oil" },
  { id: "bauxite", name: "보크사이트", category: "resource", medium: "solid", unit: "item", defaultColor: "#A34F36", geometryType: "ore_chunk", unlockId: "chemistry_stable", stackSize: 100, modelKey: "ore_bauxite" },
  { id: "tungsten_ore", name: "텅스텐광", category: "resource", medium: "solid", unit: "item", defaultColor: "#3B4650", geometryType: "crystal_cluster", unlockId: "thermal_verified", stackSize: 100, modelKey: "ore_tungsten" },

  // 시작 단계 소재와 부품
  { id: "iron_ingot", name: "철 주괴", category: "material", medium: "solid", unit: "item", defaultColor: "#8997A1", geometryType: "ingot", unlockId: "start", stackSize: 100, modelKey: "ingot_iron" },
  { id: "copper_ingot", name: "구리 주괴", category: "material", medium: "solid", unit: "item", defaultColor: "#C87545", geometryType: "ingot", unlockId: "start", stackSize: 100, modelKey: "ingot_copper" },
  { id: "iron_plate", name: "철판", category: "material", medium: "solid", unit: "item", defaultColor: "#AAB4BA", geometryType: "plate", unlockId: "start", stackSize: 100, modelKey: "plate_iron", hubItem: true },
  { id: "iron_rod", name: "철봉", category: "material", medium: "solid", unit: "item", defaultColor: "#84929C", geometryType: "rod_bundle", unlockId: "start", stackSize: 100, modelKey: "rod_iron", hubItem: true },
  { id: "construction_block", name: "건축 블록", category: "material", medium: "solid", unit: "item", defaultColor: "#D5C9A8", geometryType: "block", unlockId: "start", stackSize: 100, modelKey: "block_construction" },
  { id: "fastener_pack", name: "체결재 팩", category: "part", medium: "solid", unit: "item", defaultColor: "#6D7881", geometryType: "parts_pack", unlockId: "start", stackSize: 100, modelKey: "pack_fastener" },

  // 1단계 완료 이후 산업 소재와 부품
  { id: "copper_wire", name: "구리선", category: "material", medium: "solid", unit: "item", defaultColor: "#D97742", geometryType: "wire_coil", unlockId: "phase_1_complete", stackSize: 200, modelKey: "wire_copper", hubItem: true },
  { id: "steel_billet", name: "강철 빌릿", category: "material", medium: "solid", unit: "item", defaultColor: "#4B5D67", geometryType: "billet", unlockId: "phase_1_complete", stackSize: 100, modelKey: "billet_steel", hubItem: true },
  { id: "gear_set", name: "기어 세트", category: "part", medium: "solid", unit: "item", defaultColor: "#63727B", geometryType: "gear_set", unlockId: "phase_1_complete", stackSize: 100, modelKey: "gear_set" },
  { id: "electromagnetic_coil", name: "전자기 코일", category: "part", medium: "solid", unit: "item", defaultColor: "#C86B36", geometryType: "coil", unlockId: "phase_1_complete", stackSize: 100, modelKey: "coil_electromagnetic" },
  { id: "industrial_motor", name: "산업 모터", category: "part", medium: "solid", unit: "item", defaultColor: "#384952", geometryType: "motor", unlockId: "phase_1_complete", stackSize: 50, modelKey: "motor_industrial", hubItem: true },
  { id: "industrial_frame", name: "산업 프레임", category: "part", medium: "solid", unit: "item", defaultColor: "#586771", geometryType: "frame", unlockId: "phase_1_complete", stackSize: 50, modelKey: "frame_industrial" },

  // 2단계 완료 이전 전자 공정과 프로젝트 부품
  { id: "basic_control_circuit", name: "기초 제어회로", category: "part", medium: "solid", unit: "item", defaultColor: "#3B8F69", geometryType: "circuit_board", unlockId: "phase_2_complete", stackSize: 100, modelKey: "circuit_basic_control", hubItem: true },
  { id: "automation_core", name: "자동화 코어", category: "project", medium: "solid", unit: "item", defaultColor: "#40D8D0", geometryType: "core", unlockId: "phase_2_complete", stackSize: 50, modelKey: "core_automation" },

  // 유체·화학 공정
  { id: "polymer_resin", name: "고분자 수지", category: "material", medium: "solid", unit: "item", defaultColor: "#D6A05C", geometryType: "resin_pellet", unlockId: "phase_3_complete", stackSize: 100, modelKey: "resin_polymer" },
  { id: "fuel_gas", name: "연료 가스", category: "fluid", medium: "fluid", unit: "m3", defaultColor: "#E6B95B", geometryType: "fluid", unlockId: "phase_3_complete", stackSize: 100, modelKey: "fluid_fuel_gas" },
  { id: "insulation_sheet", name: "절연 시트", category: "material", medium: "solid", unit: "item", defaultColor: "#ECE3C5", geometryType: "sheet", unlockId: "phase_3_complete", stackSize: 100, modelKey: "sheet_insulation" },
  { id: "refined_quartz", name: "정제 석영", category: "material", medium: "solid", unit: "item", defaultColor: "#DCE9FF", geometryType: "crystal_cluster", unlockId: "phase_3_complete", stackSize: 100, modelKey: "quartz_refined" },
  { id: "insulated_board", name: "절연 기판", category: "part", medium: "solid", unit: "item", defaultColor: "#356F62", geometryType: "circuit_board", unlockId: "phase_3_complete", stackSize: 100, modelKey: "board_insulated" },
  { id: "advanced_control_board", name: "고급 제어보드", category: "part", medium: "solid", unit: "item", defaultColor: "#2A9B78", geometryType: "circuit_board", unlockId: "phase_3_complete", stackSize: 50, modelKey: "board_advanced_control" },
  { id: "optical_sensor", name: "광학 센서", category: "part", medium: "solid", unit: "item", defaultColor: "#77D7E8", geometryType: "sensor", unlockId: "phase_3_complete", stackSize: 100, modelKey: "sensor_optical" },

  // 경금속 공정과 4단계 프로젝트 부품
  { id: "alumina", name: "알루미나", category: "material", medium: "solid", unit: "item", defaultColor: "#EEE7DC", geometryType: "powder", unlockId: "chemistry_stable", stackSize: 100, modelKey: "powder_alumina" },
  { id: "carbon_electrode", name: "탄소 전극", category: "material", medium: "solid", unit: "item", defaultColor: "#313238", geometryType: "electrode", unlockId: "chemistry_stable", stackSize: 100, modelKey: "electrode_carbon" },
  { id: "aluminum_ingot", name: "알루미늄 주괴", category: "material", medium: "solid", unit: "item", defaultColor: "#C8D1D6", geometryType: "ingot", unlockId: "chemistry_stable", stackSize: 100, modelKey: "ingot_aluminum" },
  { id: "lightweight_case", name: "경량 케이스", category: "material", medium: "solid", unit: "item", defaultColor: "#B8C5CB", geometryType: "case", unlockId: "chemistry_stable", stackSize: 100, modelKey: "case_lightweight" },
  { id: "steel_beam", name: "강철 빔", category: "material", medium: "solid", unit: "item", defaultColor: "#53656F", geometryType: "beam", unlockId: "chemistry_stable", stackSize: 100, modelKey: "beam_steel" },
  { id: "industrial_power_cell", name: "산업 전력 셀", category: "project", medium: "solid", unit: "item", defaultColor: "#E7A83A", geometryType: "power_cell", unlockId: "chemistry_stable", stackSize: 50, modelKey: "power_cell_industrial" },
  { id: "precision_actuator", name: "정밀 액추에이터", category: "project", medium: "solid", unit: "item", defaultColor: "#B76038", geometryType: "actuator", unlockId: "chemistry_stable", stackSize: 50, modelKey: "actuator_precision" },
  { id: "lightweight_structural_shell", name: "경량 구조 셸", category: "project", medium: "solid", unit: "item", defaultColor: "#AABBC4", geometryType: "shell", unlockId: "chemistry_stable", stackSize: 20, modelKey: "shell_lightweight_structural" },

  // 고온 소재와 최종 프로젝트
  { id: "tungsten_ingot", name: "텅스텐 주괴", category: "material", medium: "solid", unit: "item", defaultColor: "#43505B", geometryType: "ingot", unlockId: "thermal_verified", stackSize: 100, modelKey: "ingot_tungsten" },
  { id: "tungsten_component", name: "텅스텐 부품", category: "part", medium: "solid", unit: "item", defaultColor: "#52606A", geometryType: "component", unlockId: "thermal_verified", stackSize: 100, modelKey: "component_tungsten" },
  { id: "thermal_control_module", name: "열 제어 모듈", category: "project", medium: "solid", unit: "item", defaultColor: "#E06C3E", geometryType: "module", unlockId: "thermal_verified", stackSize: 50, modelKey: "module_thermal_control" },
  { id: "high_density_power_cell", name: "고밀도 전력 셀", category: "part", medium: "solid", unit: "item", defaultColor: "#EEB13D", geometryType: "power_cell", unlockId: "thermal_verified", stackSize: 50, modelKey: "power_cell_high_density" },
  { id: "colony_seed_ax17", name: "AX-17 개척 시드", category: "project", medium: "solid", unit: "item", defaultColor: "#3ED8C7", geometryType: "seed", unlockId: "thermal_verified", stackSize: 1, modelKey: "colony_seed_ax17" },
] as const satisfies readonly CompleteItemDefinition[];
