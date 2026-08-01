import * as THREE from "three";

export type GridPowerVisualState = Readonly<{
  time: number;
  powered: boolean;
  overloaded: boolean;
  supplyRatio?: number;
}>;

export type GridStateOptions = Readonly<{
  indicator?: boolean;
  indicatorAnchor?: Readonly<{ x: number; y: number; z: number }>;
  blackoutOpacity?: number;
  overloadOpacity?: number;
  excludeMesh?: (mesh: THREE.Mesh) => boolean;
}>;

const OVERLAY_ROLE = "gridStateOverlay";
const INDICATOR_ROLE = "gridStateIndicator";
const controllers = new WeakMap<THREE.Group, GridStateController>();

const defaultExcluded = (mesh: THREE.Mesh) => {
  const role = String(mesh.userData.animationRole ?? "").toLowerCase();
  return ["status", "port", "pulse", "beacon", "gauge", "glow", "spark", "dust", "direction"]
    .some((keyword) => role.includes(keyword));
};

const clampOpacity = (value: number | undefined, fallback: number) => THREE.MathUtils.clamp(
  Number.isFinite(value) ? value! : fallback,
  0,
  0.75,
);

const indicatorPosition = (
  target: THREE.Group,
  explicit?: Readonly<{ x: number; y: number; z: number }>,
) => {
  if (explicit) return new THREE.Vector3(explicit.x, explicit.y, explicit.z);
  target.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(target);
  if (bounds.isEmpty()) return new THREE.Vector3(0, 1, 0);
  const worldPosition = new THREE.Vector3(
    bounds.max.x,
    bounds.max.y + Math.max(0.08, bounds.getSize(new THREE.Vector3()).y * 0.035),
    bounds.max.z,
  );
  return target.worldToLocal(worldPosition);
};

const setIndicatorMaterial = (
  material: THREE.MeshStandardMaterial,
  color: number,
  emissive: number,
  intensity: number,
) => {
  material.color.setHex(color);
  material.emissive.setHex(emissive);
  material.emissiveIntensity = intensity;
};

/**
 * Adds removable overlay children without replacing or cloning any source
 * material. Overlay meshes share source geometry and follow animated parents.
 */
export class GridStateController {
  private readonly target: THREE.Group;
  private readonly options: GridStateOptions;
  private readonly overlays: Array<{ source: THREE.Mesh; overlay: THREE.Mesh }> = [];
  private readonly overlayMaterial = new THREE.MeshBasicMaterial({
    color: 0x071116,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    toneMapped: false,
  });
  private readonly indicator: THREE.Group;
  private readonly indicatorMaterial: THREE.MeshStandardMaterial;
  private readonly indicatorRing: THREE.Mesh;
  private readonly blackoutOpacity: number;
  private readonly overloadOpacity: number;
  private disposed = false;

  constructor(
    target: THREE.Group,
    options: GridStateOptions = {},
  ) {
    this.target = target;
    this.options = options;
    this.blackoutOpacity = clampOpacity(options.blackoutOpacity, 0.18);
    this.overloadOpacity = clampOpacity(options.overloadOpacity, 0.14);
    this.collectOverlays();

    this.indicatorMaterial = new THREE.MeshStandardMaterial({
      color: 0x5de4d1,
      emissive: 0x1a8f82,
      emissiveIntensity: 0.65,
      metalness: 0.2,
      roughness: 0.3,
      toneMapped: false,
    });
    this.indicator = new THREE.Group();
    this.indicator.name = "grid-state-indicator";
    this.indicator.userData.animationRole = INDICATOR_ROLE;
    this.indicator.position.copy(indicatorPosition(target, options.indicatorAnchor));
    this.indicator.visible = options.indicator !== false;

    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.055, 9, 6), this.indicatorMaterial);
    lamp.userData.animationRole = INDICATOR_ROLE;
    lamp.castShadow = false;
    lamp.raycast = () => undefined;
    this.indicator.add(lamp);
    this.indicatorRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.09, 0.012, 5, 10),
      this.indicatorMaterial,
    );
    this.indicatorRing.rotation.x = Math.PI / 2;
    this.indicatorRing.userData.animationRole = INDICATOR_ROLE;
    this.indicatorRing.raycast = () => undefined;
    this.indicator.add(this.indicatorRing);
    target.add(this.indicator);
  }

  /** Adds overlays for meshes appended to a procedural model after setup. */
  refresh() {
    this.assertActive();
    this.collectOverlays();
  }

  update(state: GridPowerVisualState) {
    this.assertActive();
    const supply = THREE.MathUtils.clamp(state.supplyRatio ?? (state.powered ? 1 : 0), 0, 1);
    const showOverlay = state.overloaded || !state.powered;
    this.overlayMaterial.visible = showOverlay;
    if (state.overloaded) {
      this.overlayMaterial.color.setHex(0xff263f);
      this.overlayMaterial.opacity = this.overloadOpacity * (0.65 + (Math.sin(state.time * 7) * 0.5 + 0.5) * 0.65);
      setIndicatorMaterial(
        this.indicatorMaterial,
        0xff5268,
        0xa8172b,
        2 + Math.sin(state.time * 7) * 0.45,
      );
      this.indicatorRing.scale.setScalar(0.9 + (Math.sin(state.time * 7) * 0.5 + 0.5) * 0.35);
      this.indicatorRing.rotation.z = state.time * 1.8;
    } else if (!state.powered) {
      this.overlayMaterial.color.setHex(0x071116);
      this.overlayMaterial.opacity = this.blackoutOpacity;
      setIndicatorMaterial(this.indicatorMaterial, 0x6f7d80, 0x071116, 0.04);
      this.indicatorRing.scale.setScalar(0.8);
      this.indicatorRing.rotation.z = 0;
    } else {
      this.overlayMaterial.opacity = 0;
      setIndicatorMaterial(this.indicatorMaterial, 0x5de4d1, 0x1a8f82, 0.35 + supply * 0.9);
      this.indicatorRing.scale.setScalar(0.85 + supply * 0.15);
      this.indicatorRing.rotation.z = state.time * (0.12 + supply * 0.28);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const { source, overlay } of this.overlays) source.remove(overlay);
    this.overlays.length = 0;
    this.target.remove(this.indicator);
    this.indicator.traverse((part: THREE.Object3D) => {
      if (part instanceof THREE.Mesh) part.geometry.dispose();
    });
    this.indicatorMaterial.dispose();
    this.overlayMaterial.dispose();
    controllers.delete(this.target);
  }

  private collectOverlays() {
    const existing = new Set(this.overlays.map(({ source }) => source));
    const candidates: THREE.Mesh[] = [];
    this.target.traverse((part: THREE.Object3D) => {
      if (!(part instanceof THREE.Mesh) || existing.has(part)) return;
      if (part.userData.animationRole === OVERLAY_ROLE || part.userData.animationRole === INDICATOR_ROLE) return;
      if ((this.options.excludeMesh ?? defaultExcluded)(part)) return;
      candidates.push(part);
    });
    for (const source of candidates) {
      const overlay = new THREE.Mesh(source.geometry, this.overlayMaterial);
      overlay.name = "grid-state-overlay";
      overlay.userData.animationRole = OVERLAY_ROLE;
      overlay.scale.setScalar(1.002);
      overlay.castShadow = false;
      overlay.receiveShadow = false;
      overlay.renderOrder = source.renderOrder + 1;
      overlay.raycast = () => undefined;
      source.add(overlay);
      this.overlays.push({ source, overlay });
    }
  }

  private assertActive() {
    if (this.disposed) throw new Error("GridStateController has been disposed");
  }
}

export const createGridStateController = (target: THREE.Group, options?: GridStateOptions) => {
  const existing = controllers.get(target);
  if (existing) return existing;
  const controller = new GridStateController(target, options);
  controllers.set(target, controller);
  return controller;
};

export const applyGridVisualState = (
  target: THREE.Group,
  state: GridPowerVisualState,
  options?: GridStateOptions,
) => {
  const controller = createGridStateController(target, options);
  controller.update(state);
  return controller;
};

export const removeGridVisualState = (target: THREE.Group) => {
  controllers.get(target)?.dispose();
};
