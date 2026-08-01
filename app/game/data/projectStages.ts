import type { ProjectStageDefinition } from "../domain/types.ts";

const solidDelivery = (itemId: string, amount: number, portId: string) => ({
  itemId,
  amount,
  medium: "solid" as const,
  portId,
  commitPolicy: "solid_lock_complete" as const,
});

const fluidDelivery = (itemId: string, amount: number, portId = "fluid_in") => ({
  itemId,
  amount,
  medium: "fluid" as const,
  portId,
  commitPolicy: "fluid_accepted_per_tick" as const,
});

export const START_PROJECT_STAGES = [
  {
    id: "phase_1_settlement_package",
    completionUnlockId: "phase_1_complete",
    prerequisiteIds: [],
    deliveries: [
      solidDelivery("iron_plate", 120, "phase1_plate_in"),
      solidDelivery("construction_block", 80, "phase1_block_in"),
      solidDelivery("fastener_pack", 40, "phase1_fastener_in"),
    ],
    rewards: {
      resourceIds: ["coal"],
      itemIds: ["coal", "copper_wire", "steel_billet", "gear_set", "electromagnetic_coil", "industrial_motor", "industrial_frame"],
      recipeIds: [
        "mine_coal", "wind_copper_wire", "alloy_steel_billet", "assemble_gear_set",
        "assemble_electromagnetic_coil", "assemble_industrial_motor", "assemble_industrial_frame",
      ],
      buildingIds: ["alloy_furnace", "industrial_winder", "precision_assembler", "solid_fuel_generator", "conveyor_mk2"],
    },
    dockPowerMode: "manual",
    completionSequence: "settlement_package_lock_and_launch",
  },
  {
    id: "phase_2_industrial_power_node",
    completionUnlockId: "phase_2_complete",
    prerequisiteIds: ["phase_1_settlement_package"],
    deliveries: [
      solidDelivery("steel_billet", 160, "phase1_plate_in"),
      solidDelivery("copper_wire", 200, "phase1_block_in"),
      solidDelivery("electromagnetic_coil", 80, "phase1_fastener_in"),
      solidDelivery("industrial_frame", 20, "reserved_solid_in_1"),
    ],
    rewards: {
      resourceIds: ["quartz"],
      itemIds: ["quartz", "basic_control_circuit", "automation_core"],
      recipeIds: ["mine_quartz", "print_basic_control_circuit", "manufacture_automation_core"],
      buildingIds: [
        "circuit_printer", "heavy_manufacturer", "industrial_storage", "industrial_accumulator",
        "power_breaker", "priority_switchboard", "distribution_pole_mk2", "substation", "high_voltage_tower",
      ],
    },
    dockPowerMode: "manual",
    completionSequence: "industrial_power_node_lock_and_grid_boot",
  },
  {
    id: "phase_3_automation_core",
    completionUnlockId: "phase_3_complete",
    prerequisiteIds: ["phase_2_industrial_power_node"],
    deliveries: [solidDelivery("automation_core", 120, "phase1_plate_in")],
    rewards: {
      resourceIds: ["crude_oil"],
      itemIds: [
        "crude_oil", "polymer_resin", "fuel_gas", "insulation_sheet", "refined_quartz",
        "insulated_board", "advanced_control_board", "optical_sensor",
      ],
      recipeIds: [
        "extract_crude_oil", "refine_crude_oil", "form_insulation_sheet", "crush_refined_quartz",
        "print_insulated_board", "print_advanced_control_board", "print_optical_sensor",
      ],
      buildingIds: [
        "fluid_extractor", "fractionation_refinery", "pipe_mk1", "pipe_t_junction", "fluid_tank",
        "pipe_pump", "emergency_flare", "combined_fuel_turbine", "conveyor_mk3",
      ],
      constructionCredits: {
        pipe_mk1_length_m: 48,
        pipe_t_junction: 2,
        fluid_tank: 1,
        pipe_pump: 1,
      },
    },
    dockPowerMode: "powered",
    requiredPowerMW: 32,
    completionSequence: "automation_core_powered_cradle_commit",
  },
  {
    id: "phase_4_chemistry_stabilization",
    completionUnlockId: "chemistry_stable",
    prerequisiteIds: ["phase_3_automation_core"],
    deliveries: [
      solidDelivery("polymer_resin", 200, "phase1_plate_in"),
      fluidDelivery("fuel_gas", 400),
    ],
    rewards: {
      resourceIds: ["bauxite"],
      itemIds: [
        "bauxite", "alumina", "carbon_electrode", "aluminum_ingot", "lightweight_case",
        "steel_beam", "industrial_power_cell", "precision_actuator", "lightweight_structural_shell",
      ],
      recipeIds: [
        "mine_bauxite", "crush_alumina", "form_carbon_electrode", "reduce_aluminum_ingot",
        "form_lightweight_case", "form_steel_beam", "manufacture_industrial_power_cell",
        "manufacture_precision_actuator", "manufacture_lightweight_structural_shell",
      ],
      buildingIds: ["electrolytic_reducer"],
    },
    dockPowerMode: "powered",
    requiredPowerMW: 32,
    completionSequence: "chemistry_stabilization_pressure_purge",
  },
  {
    id: "phase_4_thermal_management_verification",
    completionUnlockId: "thermal_verified",
    prerequisiteIds: ["phase_4_chemistry_stabilization"],
    deliveries: [
      solidDelivery("advanced_control_board", 20, "phase1_plate_in"),
      solidDelivery("lightweight_structural_shell", 2, "reserved_solid_in_2"),
    ],
    rewards: {
      resourceIds: ["tungsten_ore"],
      itemIds: ["tungsten_ore", "tungsten_ingot", "tungsten_component", "thermal_control_module", "high_density_power_cell"],
      recipeIds: [
        "mine_tungsten_ore", "smelt_tungsten_ingot", "form_tungsten_component",
        "manufacture_thermal_control_module", "manufacture_high_density_power_cell",
      ],
      buildingIds: ["high_density_thermal_plant"],
    },
    dockPowerMode: "powered",
    requiredPowerMW: 32,
    completionSequence: "thermal_management_load_and_heat_test",
  },
  {
    id: "phase_4_colony_seed",
    prerequisiteIds: ["phase_4_thermal_management_verification"],
    deliveries: [
      solidDelivery("lightweight_structural_shell", 10, "phase1_plate_in"),
      solidDelivery("precision_actuator", 20, "phase1_fastener_in"),
      solidDelivery("industrial_power_cell", 20, "phase1_block_in"),
      solidDelivery("thermal_control_module", 10, "reserved_solid_in_1"),
      solidDelivery("automation_core", 10, "reserved_solid_in_2"),
    ],
    rewards: {
      resourceIds: [],
      itemIds: ["colony_seed_ax17"],
      recipeIds: [],
      buildingIds: [],
    },
    dockPowerMode: "powered",
    requiredPowerMW: 32,
    completionSequence: "ax17_colony_seed_final_assembly_and_launch",
    repeatable: true,
  },
] as const satisfies readonly ProjectStageDefinition[];
