# FactoryX 지형 기술 아키텍처

> - 문서 상태: 기술 설계 초안 v0.1
> - 범위: World Studio 원본 데이터, 지형 베이크, TerrainSampler, 청크·LOD, Blender GLB, 절벽, 수계, 동굴, 원경과 테스트
> - 상위 계획: `terrain-worldbuilding-plan.ko.md`
> - 관련 제작 규격: `world-environment-detail-pipeline.ko.md`
> - 구현 원칙: 기존 32m 청크와 결정적 샘플러를 유지하면서 입력 데이터, 수직 구조와 실제 스트리밍을 확장한다.

---

## 1. 기술 결론

현재 FactoryX는 이미 다음 기반을 가진다.

- 약 256×256m 월드 경계
- 32m 지형 청크
- 65/33/17 격자에 대응하는 LOD0/1/2
- 결정적 CPU `TerrainSampler`
- skirt를 가진 청크 메시
- 카메라 주변 활성 청크 관리자
- 근거리 자연물 `InstancedMesh`
- World Studio의 지형·바이옴·표면·산포 브러시
- GLB 환경 자산 로더와 기본 검증 도구

따라서 geometry clipmap이나 복셀 지형 엔진으로 전면 재작성할 필요는 없다. 필요한 변화는 다음 다섯 가지다.

1. 원형 스트로크 중심의 World Studio를 토폴로지 편집기로 확장
2. 하나의 글로벌 높이 함수를 수작업 매크로 형태와 마스크 기반 합성으로 교체
3. 월드 전체 메시 선생성을 실제 청크 풀링·스트리밍으로 교체
4. 절벽, 수계와 동굴을 각자의 데이터·렌더·충돌 계약으로 분리
5. Blender 자산의 LOD, 충돌, 소켓과 재질을 런타임에서 실제 사용

---

## 2. 현재 코드 감사

### 2.1 유지할 기반

| 구성 | 현재 역할 | 유지 이유 |
| --- | --- | --- |
| `TerrainSampler` | 높이, 법선, 경사, 표면, 건설성의 권위 샘플 | 렌더와 게임 로직이 같은 결과를 사용한다. |
| `TerrainChunkManager` | 카메라 중심 3×3 또는 5×5 활성 범위 | 웹 환경에 맞는 제한된 작업 집합이다. |
| `TerrainRenderer` | 32m 청크와 3단 LOD, skirt | 문서의 65/33/17 격자 규격과 호환된다. |
| `World Studio` | 지형 편집과 환경 프리뷰 | 실시간 디자인·검수 환경으로 확장할 수 있다. |
| `EnvironmentAssetLoader` | GLB 환경 자산 로드 | Blender 키트 통합의 출발점이다. |

### 2.2 World Studio는 아직 토폴로지 편집기가 아니다

현재 `app/game/environment/authoring.ts`의 문서 v2는 다음 데이터만 중심적으로 저장한다.

- 원형 브러시 스트로크
- 시간, 태양, 안개와 날씨
- 산포 밀도와 프리뷰 품질
- 랜드마크 위치 오프셋

현재 없는 핵심 데이터:

- 능선·절벽·도로·강 스플라인
- 호수·습지·건설지 폴리곤
- 분지·고원·단층 같은 매크로 프리미티브
- 동굴 방·회랑·포털 그래프
- 일반 자산 배치와 접합 소켓
- 저장 가능한 검수 카메라
- 편집 레이어, 순서, 잠금과 우선순위
- 베이크 버전과 콘텐츠 해시

또한 현재 바이옴·표면 페인트는 마지막 원형 스트로크가 반경 내부를 우선하는 방식이라 전이 폭과 강도를 풍부하게 표현하기 어렵다.

### 2.3 하나의 높이 함수가 모든 바이옴을 닮게 만든다

`app/game/environment/terrain/TerrainSampler.ts`의 기본 지형은 다음을 합성한다.

- `folded` 사인파
- `strata` 사인파
- 72m 규모 `macro` 노이즈
- 15m와 5m 규모 `detail` 노이즈
- 바이옴별 작은 regional 보정
- 철풍 단층지와 적철 왕관고원의 제한된 shelf 보정

좋은 결정적 프로토타입이지만 모든 바이옴이 같은 기본 주파수와 함수를 공유하므로 실루엣이 닮기 쉽다. 앞으로는 바이옴별 매크로 형태를 월드 데이터에서 직접 가져오고, 기존 노이즈는 낮은 진폭의 침식·표면 디테일로 내린다.

### 2.4 월드 경계 규칙이 모호하다

현재 `environment.ts`는 `-128..127`을 사용하지만 `TerrainRenderer`는 `max - min + 1`을 폭으로 계산한다. 셀 좌표, 연속 월드 좌표와 높이 표본 경계가 같은 숫자를 서로 다르게 해석할 수 있다.

명시할 규칙:

- `worldAabb`: 미터 단위 반개구간 `[-128, 128)`
- `constructionCellBounds`: 정수 셀 `[-128, 127]`
- `heightSampleBounds`: 양쪽 경계를 포함하는 513개 표본
- 청크 좌표: min-inclusive, max-exclusive
- 마지막 청크의 외곽 높이 표본은 이웃 섹터 또는 halo에서 제공

### 2.5 현재 스트리밍은 가시성 전환이다

`TerrainChunkManager`는 카메라 주변 청크만 활성 상태로 반환한다. 하지만 `TerrainRenderer` 생성자는 월드 전체 64개 청크의 LOD 세 종류, 총 192개 메시를 먼저 만든다. 업데이트에서는 모든 메시를 숨긴 뒤 활성 LOD만 다시 표시한다.

현재 256m에서는 작동하지만 512m로 확장하면 16×16×3, 총 768개 지형 메시를 먼저 생성한다. 정점·인덱스 버퍼와 객체 오버헤드가 CPU와 GPU 양쪽에서 커진다.

필요한 실제 상태:

```text
unloaded
→ requested
→ sampled-in-worker
→ uploaded
→ active
→ retained
→ evicted
```

요청 식별자:

```text
worldHash + chunkX + chunkZ + lod + terrainRevision
```

오래된 Worker 응답은 폐기하고, 새 LOD가 준비되기 전에는 이전 LOD를 유지해 빈 프레임을 만들지 않는다.

### 2.6 문서와 현재 LOD 동작의 차이

- 제작 문서는 고품질 5×5 범위 중 가까운 3×3을 LOD0로 권장한다.
- 현재 `TerrainChunkManager`는 중앙 한 청크만 LOD0로 지정한다.
- LOD 링 경계에 거리 히스테리시스와 geomorph가 없다.
- 현재 테스트는 같은 LOD 경계 위주이며 LOD0↔LOD1 혼합 경계를 충분히 검사하지 않는다.
- `THREE.LOD`는 독립 절벽·아치·랜드마크에는 적합하지만 이웃 경계를 맞춰야 하는 높이장 청크에는 커스텀 관리자가 필요하다.

### 2.7 편집 후 파생 데이터가 함께 갱신되지 않는다

높이 편집 시 지형 메시와 일부 산포는 갱신되지만 물, 해안선과 절벽 강조물은 생성 시점 계산에 가깝다. 지형을 낮춰도 물이 생기지 않거나 절벽을 평탄화해도 강조물이 남을 수 있다.

필요한 dirty dependency graph:

```text
height
├─ normal / slope
├─ collision / construction
├─ cliff band / cliff placement
├─ water depth / shoreline
├─ biome material masks
└─ rock / vegetation scatter
```

브러시 드래그 중에는 저해상도 프리뷰를 사용하고 pointer-up 또는 commit에서 영향 청크와 1표본 halo를 베이크한다. 원형 스트로크를 매 표본마다 영구 재생하지 않고 일정 시점에 타일형 delta와 mask로 베이크한다.

### 2.8 현재 물은 하나의 수계가 아니다

`SurfaceFeatureRenderer`는 4m 또는 8m 셀을 검사해 사각 수면과 박스 해안선을 만든다. 위치별 노이즈가 수위에 들어가 같은 호수 안에서도 수면 높이가 조금 달라질 수 있다. 물 전체 root를 위아래로 움직이는 애니메이션은 고정 해안과 순간적으로 어긋난다.

교체 원칙:

- 호수·습지: 고정 수위의 평면 폴리곤
- 하천: 폭과 고도가 변하는 스플라인 strip
- 폭포: 낙차 소켓과 별도 수직 메시·FX
- 해안: 동일 수체 폴리곤에서 파생된 depth·wetness ribbon
- 물 애니메이션: 메시 높이 이동이 아니라 shader normal·UV 시간 변화

### 2.9 절벽 GLB 계약이 런타임 충돌과 연결되지 않았다

현재 절벽은 급경사에 무작위로 놓인 얇은 박스 인스턴스다. GLB 로더가 `COL_SIMPLE`을 찾을 수는 있지만 소품 충돌은 여전히 단순 반경 중심이며, 소켓과 `extras`, GLB 재질 정책도 통합 계약이 없다.

첫 절벽 전에 결정할 항목:

- 재질 정책: `runtime_shared` 또는 `gltf_pbr`
- 충돌 종류: `walkable`, `wall`, `build_exclusion`, `decorative`
- 소켓: `cliff.start/end`, `cliff.top/bottom`, `talus.attach`, `cave.portal`
- LOD별 동일 pivot, bounds와 접지 기준
- Blender Empty의 world transform 추출법
- 절벽 상·하단 rail과 높이장 제거 띠
- 시각 절벽과 충돌 장벽의 최대 허용 오차

### 2.10 현재 동굴은 실제 지형 포털이 아니다

현재 동굴은 구·원통 셸 중심이며 입구는 지표 위 시각 장식으로 가린다. 높이장 삼각형과 표면 충돌에는 실제 포털 구멍이 없다.

필요한 변화:

- 통로를 방 배열 순서가 아닌 명시적 graph edge로 저장
- portal footprint 안의 지표 렌더 삼각형과 충돌을 함께 제거
- 지표 절개와 동굴 셸 사이를 전환 GLB로 봉합
- 방별 바닥 폴리곤, 천장 높이, 건설 볼륨과 포털 저장
- 현재 방과 포털로 연결된 인접 방만 활성화
- 입구 overlap 구간에서만 지상과 동굴을 동시 렌더
- 동굴 밖에서는 동굴 geometry, light와 fog 비용을 거의 0으로 유지

---

## 3. 좌표와 월드 경계 계약

### 3.1 좌표계

- 오른손 좌표계
- `+Y` 위
- 월드 전방 규약은 프로젝트에서 `+Z`로 고정
- 1 unit = 1m
- 회전은 런타임에서 quaternion을 권위값으로 저장
- Blender GLB 출력은 glTF의 오른손 좌표계와 `+Y` up 규격에 맞춘다.

### 3.2 경계

```ts
type WorldBounds = {
  minX: number;
  maxXExclusive: number;
  minZ: number;
  maxZExclusive: number;
};
```

첫 섹터:

```text
worldAabb            x/z [-128, 128)
construction cells   x/z integer [-128, 127]
chunk size           32m
chunk grid           8×8
LOD0 spacing         0.5m
master samples       513×513 including outer boundary
```

섹터 경계의 중복 표본은 한쪽을 권위로 정하거나 world-space 동일 좌표를 같은 함수·베이크 원본에서 샘플한다.

---

## 4. World Studio 원본 계약

### 4.1 `WorldSourceV3`

```ts
type WorldSourceV3 = {
  format: "factoryx-world";
  schemaVersion: 3;
  environmentId: string;
  environmentVersion: number;
  generatorVersion: number;
  seed: number;
  coordinateSystem: {
    handedness: "right";
    up: "+Y";
    forward: "+Z";
    unit: "meter";
  };
  bounds: WorldBounds;
  chunkSize: 32;
  sampleSpacing: 0.5;

  macroForms: MacroForm[];
  biomeRegions: BiomeRegion[];
  splines: WorldSpline[];
  waterBodies: WaterBody[];
  caves: CaveGraph[];
  gameplayZones: GameplayZone[];
  placements: AssetPlacement[];
  resourceAnchors: ResourceAnchor[];
  reviewCameras: ReviewCamera[];
};
```

이 타입은 구현 전에 검토할 계약 초안이다.

### 4.2 공통 규칙

- 모든 요소는 편집 후에도 바뀌지 않는 stable ID를 가진다.
- 배열 순서가 결과를 바꾸는 경우 `priority`와 `operation`을 명시한다.
- 폴리곤은 마지막 점을 반복하지 않고 외곽 CCW, 구멍 CW 규칙을 사용한다.
- 스플라인은 원본 control point와 베이크된 polyline을 구분한다.
- 카메라는 transform, FOV, 시간, 날씨, 품질과 기대 랜드마크 ID를 가진다.
- `localStorage`는 임시 초안이며 버전 관리되는 source JSON이 최종 원본이다.
- 기존 v2 스트로크는 `legacySculptLayer`로 이관해 손실 없이 읽는다.
- import와 게임 런타임이 같은 parser와 validator를 사용한다.

### 4.3 편집 레이어

권장 순서:

1. base elevation
2. macro forms
3. hydrology carve
4. routes and build patches
5. cliff bands
6. biome regions
7. legacy sculpt and local corrections
8. surface and gameplay masks
9. asset placements and scatter clusters

레이어마다 보임, 잠금, 순서, 우선순위와 dirty bounds를 가진다.

### 4.4 편집 도구

| 도구 | 데이터 | 표시·검증 |
| --- | --- | --- |
| Macro Shape | 분지, 고원, 능선, 단층, 협곡, 싱크홀 | 영향 범위, falloff와 고도 변화 |
| Route Spline | 차량로, 보행로, 철도 후보 | 폭, 최대 경사, 회전 반경 |
| Cliff Band | 상·하단 rail | 높이, 방향, 모듈 접합과 제거 띠 |
| River Spline | 하천 중심선 | 흐름, 폭, 바닥 고도와 역류 검사 |
| Water Polygon | 호수·습지 | 수위, 깊이, 해안과 침수 영역 |
| Biome Region | 바이옴 가중치 | 전이 폭과 정규화 결과 |
| Build Patch | 공장·전초기지 | 면적, 평균 경사와 접근 경로 |
| Cave Graph | 방·회랑·포털 | 셸, 건설 볼륨과 차폐 |
| Asset Placement | 절벽·아치·랜드마크 | pivot, bounds, socket과 LOD |
| Review Camera | 회귀 화면 | FOV, 시간, 날씨와 기대 대상 |

### 4.5 디버그 오버레이

- 청크 경계와 현재 LOD
- mixed LOD edge, shared edge와 skirt
- 높이·법선·경사
- 건설 가능·연약·위험·침수 마스크
- 바이옴 가중치와 전이 폭
- 절벽·도로·하천 스플라인
- 수위, 깊이와 흐름 방향
- 자원 보호 반경과 필수 경로
- 동굴 포털, 방 셸과 cutaway
- 드로우콜, 삼각형, 텍스처와 GPU 메모리 추정치

---

## 5. 베이크 산출물 계약

### 5.1 파일 구조 초안

```text
world.manifest.json
terrain/<x>_<z>.height.bin
terrain/<x>_<z>.biome.bin
terrain/<x>_<z>.surface.bin
terrain/<x>_<z>.flow.bin
terrain/cliff-splines.bin
water/water-bodies.bin
caves/<stratum>.bin
placements/<x>_<z>.bin
render/biome-a.ktx2
render/biome-b.ktx2
```

### 5.2 높이 타일 메타데이터

- encoding과 byte order
- height offset과 scale
- sample spacing
- row order와 x-fastest 여부
- 65×65 유효 표본과 법선 계산용 1표본 halo
- source hash와 generator version
- chunk 좌표와 world bounds

### 5.3 CPU와 GPU 마스크 분리

KTX2는 GPU 압축 텍스처용이다. 장치별 GPU 포맷으로 transcode되므로 CPU `TerrainSampler`가 사용하는 유일한 바이옴·게임플레이 데이터가 될 수 없다.

- CPU: compact binary mask, 건설·충돌·게임 로직용
- GPU: KTX2 splat·material mask, 셰이더용
- 두 산출물은 같은 source hash와 generator version을 가진다.

### 5.4 결정성

같은 source, generator version과 seed에서 다음이 동일해야 한다.

- 각 청크의 height·biome·surface hash
- 자원 패드 높이
- 절벽과 수체 배치
- 산포 cluster seed와 instance transform
- review camera 결과에 영향을 주는 환경 설정

---

## 6. 높이장과 매크로 형태

### 6.1 합성 순서

```text
H = BaseElevation
  + AuthoredMacroForms
  + HydrologyCarving
  + RouteAndBuildConstraints
  + LowAmplitudeErosion
  + LocalAuthoringEdits
```

작업 순서:

1. 기본 고도와 전체 배수 방향
2. 분지, 고원, 능선, 단층과 협곡
3. 공장 테라스와 자원 패드
4. 차량·보행·철도 후보 경로
5. 집수부와 하천 침식
6. 절벽 band와 메시 접합 공간
7. 48~96m급 큰 침식
8. 12~32m급 중간 층리와 홈
9. 3~8m급 작은 표면 변화
10. 국소 수동 보정

### 6.2 매크로 프리미티브

- `basin`: 넓은 분지와 집수구역
- `plateau`: 건설 가능한 고원과 테라스
- `ridge`: 방향성 있는 능선
- `fault-step`: 단층 상·하부와 절벽 띠
- `canyon`: 스플라인을 따르는 협곡과 이동로
- `crater-ring`: 고리 고원과 붕괴 관문
- `sinkhole`: 동굴 포털과 열 균열
- `saddle`: 두 고지를 연결하는 낮은 통과점

각 형태는 위치, 방향, 크기, 높이, falloff, 바이옴, operation과 gameplay tag를 가진다. 합성 연산은 add뿐 아니라 min, max, carve와 smooth union을 구분한다.

### 6.3 바이옴 마스크

- 중심점 최근접 방식은 fallback으로만 남긴다.
- 주 바이옴은 수작업 폴리곤 또는 페인트 마스크로 정의한다.
- 가중치 합은 항상 1로 정규화한다.
- 일반 전이대는 8~24m, 큰 지질 경계는 30~50m까지 허용한다.
- 형태, 재질, 식생과 대기 경계는 서로 다른 전이 폭을 가질 수 있다.
- 전이 지역에는 양쪽 자산을 전부 반반 섞지 않고 전이 전용 소수 종을 둔다.

### 6.4 건설·자원 제약

- 자원 패드는 샘플러 계산의 사후 보정이 아니라 명시적 `BuildPatch` 또는 `ResourcePad`다.
- 패드 주변은 최소 4~8m 전이 폭을 갖는다.
- 필수 물류 회랑은 높이 생성 전에 제약으로 적용한다.
- 시각상 평평한데 건설 불가이거나, 급경사인데 건설 가능한 불일치를 허용하지 않는다.

---

## 7. 실제 청크 스트리밍과 LOD

### 7.1 지형 청크 규격

| LOD | 정점 격자 | 표본 간격 | 권장 거리 |
| --- | --- | --- | --- |
| LOD0 | 65×65 | 0.5m | 0~40m |
| LOD1 | 33×33 | 1m | 32~80m |
| LOD2 | 17×17 | 2m | 64~144m |

모든 LOD는 고해상도 원본의 같은 world-space 좌표를 샘플한다.

### 7.2 상태 머신

```ts
type ChunkLifecycle =
  | "unloaded"
  | "requested"
  | "sampled"
  | "uploaded"
  | "active"
  | "retained"
  | "evicted";
```

규칙:

- 카메라 주변 활성 청크만 풀에서 할당한다.
- Worker가 position, normal, color·mask와 index buffer를 생성한다.
- 큰 `ArrayBuffer`는 transferable로 전달한다.
- 요청 revision이 현재 terrain revision과 다르면 응답을 버린다.
- 새 LOD 업로드가 끝날 때까지 이전 LOD를 유지한다.
- retained 상태는 경계 왕복 시 재생성을 줄인다.
- eviction 시 geometry, material 참조와 GPU 자원을 명시적으로 해제한다.

### 7.3 이웃 인식 LOD

- 기본 `THREE.LOD` 대신 청크 이웃을 인식하는 관리자를 유지한다.
- LOD 단계 차이는 인접 청크 사이 최대 1단계로 제한한다.
- mixed LOD shared edge 테스트를 별도로 둔다.
- 거리 히스테리시스로 경계 왕복 떨림을 막는다.
- 필요할 경우 edge stitch index 또는 skirt를 사용하되 검은 틈이 보이지 않게 한다.
- 독립 절벽·아치·랜드마크는 `THREE.LOD`와 hysteresis를 사용할 수 있다.

### 7.4 목표 활성 범위

- 고품질: 최대 5×5 활성, 가장 가까운 3×3 중심 고해상도
- 저품질: 3×3 중심, 외곽 원경은 far terrain으로 대체
- 원거리 LOD2와 비스타 번들은 월드 진입 시 우선 로드
- 보이지 않는 섹터의 지형 메시와 자연물 인스턴스는 유지하지 않는다.

### 7.5 Geometry Clipmaps 판단

Geometry Clipmaps는 시점 중심 중첩 격자를 점진적으로 갱신하는 대규모 지형 방식이다. 현재 256m 핵심 구역에는 과하다. 플레이 가능한 지형이 수 km 규모가 되고 섹터 청크 방식의 CPU·GPU 비용이 실제 병목으로 확인된 뒤 재평가한다.

---

## 8. 편집 dirty graph와 베이크

### 8.1 파생 관계

```text
macro form / height edit
├─ height tile
├─ normal and slope
├─ collision and construction
├─ route grade
├─ cliff band and placement
├─ water depth and shoreline
├─ biome render masks
└─ rock and vegetation scatter
```

```text
water edit
├─ water mesh
├─ shoreline ribbon
├─ depth and wetness
├─ construction and hazard
└─ aquatic scatter
```

```text
biome edit
├─ CPU gameplay masks
├─ GPU KTX2 masks
├─ material assignment
├─ scatter rules
└─ local fog, sound and weather profile
```

### 8.2 편집 흐름

1. pointer drag 중 저해상도 임시 프리뷰
2. dirty world AABB 표시
3. pointer-up에서 영향 청크와 1표본 halo 요청
4. Worker가 파생 타일을 베이크
5. revision이 유효하면 CPU sampler 데이터 교체
6. 렌더 청크와 파생 시스템 갱신
7. 이전 LOD는 새 버퍼 업로드 완료까지 유지
8. undo/redo는 source 명령과 베이크 revision을 함께 되돌림

### 8.3 스트로크 베이크

현재 최대 수천 스트로크를 매 샘플에 재생하는 방식은 월드가 커질수록 비싸다. 다음 정책을 사용한다.

- 수정 중: 최근 스트로크를 실시간 적용
- commit: 청크별 height delta와 mask 타일로 베이크
- source: 편집 명령은 기록하되 런타임은 베이크 결과 사용
- compact: 오래된 스트로크를 주기적으로 레이어 데이터로 합침

---

## 9. 수계 계약

### 9.1 자료형 초안

```ts
type WaterBody =
  | {
      id: string;
      kind: "lake" | "marsh";
      polygon: Vec2[];
      level: number;
      outletSplineId?: string;
    }
  | {
      id: string;
      kind: "river";
      splineId: string;
      widthProfile: number[];
      bedProfile: number[];
      flowSpeed: number;
    }
  | {
      id: string;
      kind: "waterfall";
      fromSocket: string;
      toSocket: string;
      width: number;
    };
```

### 9.2 제작 순서

1. 고지 집수부와 최종 배출 지점 지정
2. 하천 중심 스플라인과 분기 관계 설정
3. 하천 바닥을 높이장에서 carve
4. 폭포 단차와 절벽 관문 배치
5. 호수·습지 폴리곤과 고정 수위 설정
6. 해안 단구, 진흙, 자갈과 습윤 마스크 생성
7. 건설 가능 영역, 자원과 기존 공장 침수 검사
8. 수면 LOD, 반사와 투명도 검증

### 9.3 렌더 규칙

- 같은 호수의 수면 높이는 하나의 고정값이다.
- 하천은 하류 방향으로 높이가 증가하지 않는다.
- 수면 애니메이션은 geometry Y 이동이 아니라 shader normal·UV로 표현한다.
- 해안은 수체 폴리곤과 같은 원본에서 파생한다.
- 물이 없는 청크는 water update와 draw 비용이 없다.
- 폭포는 수직 ribbon, 물보라, 안개와 소리를 별도 거리 LOD로 관리한다.

### 9.4 오프라인 보조 알고리즘

DEM의 의도치 않은 작은 폐쇄 함몰을 정리할 때 Priority-Flood 계열을 오프라인 보조로 사용할 수 있다. 하지만 수작업 하천 스플라인과 수체 폴리곤이 최종 권위다. 실시간 물리 수계 시뮬레이션은 현재 범위에서 제외한다.

---

## 10. 절벽과 Blender GLB 계약

### 10.1 높이장과 절벽 분리

```text
절벽 상단 rail + 하단 rail
→ 상·하부 높이장 테라스
→ cliff band 안 지형 삼각형 제거 또는 filler 처리
→ 절벽 시각 GLB 배치
→ wall/build-exclusion 충돌 배치
→ 상단 토양과 하단 talus 접합
```

높이장에 보이지 않는 급경사 벽을 남기지 않는다. 시각 메시와 충돌 장벽이 같은 띠를 채워야 한다.

### 10.2 자산 Manifest v2 초안

```ts
type EnvironmentAssetManifestV2 = {
  id: string;
  version: number;
  contentHash: string;
  kind: "cliff" | "cave" | "rock" | "landmark" | "flora";
  url: string;
  bounds: Box3Data;
  materialPolicy: "runtime_shared" | "gltf_pbr";

  lods: {
    node: "VIS_LOD0" | "VIS_LOD1" | "VIS_LOD2";
    distance: number;
    hysteresis: number;
    triangles: number;
    bytes: number;
  }[];

  collision: {
    node: string;
    kind: "walkable" | "wall" | "build_exclusion";
    triangles: number;
  }[];

  sockets: {
    id: string;
    type: string;
    position: Vec3;
    rotation: Quat;
  }[];
};
```

### 10.3 Blender 컬렉션과 소켓

```text
VIS_LOD0
VIS_LOD1
VIS_LOD2
COL_WALKABLE
COL_WALL
COL_BUILD_EXCLUSION
SOCKETS
```

소켓 예시:

- `cliff.start`
- `cliff.end`
- `cliff.top`
- `cliff.bottom`
- `talus.attach`
- `cave.portal`
- `waterfall.top`
- `waterfall.bottom`

Blender custom properties를 glTF `extras`로 전달하고 런타임 로더가 Empty의 world transform과 의미를 추출한다.

### 10.4 첫 절벽 키트

- 16m 직선 절벽
- 안쪽 코너
- 바깥쪽 코너
- top cap
- talus 군집
- 자연 아치

이 계약을 검증한 뒤 8m·32m 직선, 끝단과 붕괴 변형으로 확장한다.

### 10.5 검증

- glTF Validator 오류 0
- 모든 LOD에 동일 pivot과 접지 기준
- 소켓 이름과 타입 유효
- 충돌이 시각 외곽보다 5cm 이상 돌출하지 않음
- 보행면 높이 오차 2cm 이하 목표
- LOD 전환 위치 점프 5mm 이하 목표
- 화면상 2px를 넘는 실루엣 pop 없음
- 세 개 이상 연결 시 검은 틈과 즉시 읽히는 반복 없음

---

## 11. 동굴 기술 계약

### 11.1 Cave Graph

```ts
type CaveGraph = {
  id: string;
  stratumId: string;
  rooms: CaveRoom[];
  corridors: CaveCorridor[];
  portals: CavePortal[];
};

type CaveRoom = {
  id: string;
  shellAssetId: string;
  floorPolygon: Vec2[];
  floorHeight: number;
  ceilingHeight: number;
  buildVolume?: Volume;
  portalIds: string[];
};
```

통로는 배열의 암묵적 순서가 아니라 `fromRoomId`와 `toRoomId`를 명시한다.

### 11.2 지표 포털

- 포털 footprint 안의 지표 렌더 삼각형과 충돌을 같은 데이터로 제거한다.
- 지표 절개와 동굴 셸은 전환 GLB로 봉합한다.
- overlap 영역에서만 지상과 동굴을 동시에 렌더한다.
- 지표 밖에서는 동굴 조명과 fog를 비활성화한다.
- 동굴 안에서는 현재 방과 포털로 보이는 인접 방만 활성화한다.

### 11.3 게임플레이 볼륨

- `walkable`: 플레이어와 소형 운반 장비
- `vehicle-clearance`: 차량 통과 크기
- `belt-clearance`: 벨트·리프트 통과
- `pipe-clearance`: 파이프와 펌프
- `build-volume`: 설비 건설 가능 공동
- `hazard`: 열, 침수와 붕괴 위험

동굴은 아름다운 배경뿐 아니라 지표 생산망과 연결할 수 있는 물류 공간이어야 한다.

---

## 12. 재질, 자연물과 원경

### 12.1 지형 재질

- 지형과 절벽은 triplanar 또는 world-space 재질을 사용한다.
- CPU gameplay mask와 GPU render mask는 같은 source hash에서 생성한다.
- 경사, 습윤도, 노출 방향, 바이옴과 높이를 재질 입력으로 쓴다.
- 근거리만 작은 normal·roughness 디테일을 사용한다.
- 원거리에는 단순 색·거칠기와 큰 층리만 남긴다.

### 12.2 자연물 산포

- InstancedMesh를 유지한다.
- 청크별 bounding box·sphere를 계산하고 실제 frustum culling을 사용한다.
- 절벽 하부, 하천, 바람받이와 바람그늘처럼 물리 조건에 따른 군집을 만든다.
- 영웅 실루엣과 공장 패드 주변에는 exclusion zone을 둔다.
- LOD2에서는 개별 소품이 아니라 군락 덩어리로 읽히게 한다.

### 12.3 원경

- 80~220m: 저해상도 실제 far terrain
- 220m 이후: ridge·hero 비스타 메시
- 원경은 카메라를 따라붙는 카드가 아니라 월드에 고정되어 시차가 있어야 한다.
- 단순 재질, 제한된 그림자와 대기 원근을 사용한다.
- 원경과 현재 플레이 섹터의 경계에 검은 틈이 없어야 한다.

---

## 13. 테스트와 성능 게이트

### 13.1 데이터 테스트

- World Source export→import roundtrip 손실 0
- v2→v3 migration
- 중복 stable ID 거부
- 잘못된 폴리곤 winding과 self-intersection 거부
- 끊긴 spline과 범위 밖 control point 거부
- 같은 source/version/seed의 bake hash 동일
- CPU·GPU mask source hash 일치

### 13.2 지형 테스트

- LOD0↔LOD1, LOD1↔LOD2 mixed edge
- 인접 표본 높이와 법선 일치
- 경계 왕복 시 hysteresis와 pop
- stale Worker 결과 무시
- 풀 eviction 뒤 geometry·texture 해제
- 편집 후 water·cliff·scatter·collision invalidation
- CPU sampler와 렌더 높이 차 2cm 이하 목표

### 13.3 수계 테스트

- 같은 호수 수위 일정
- 하천이 하류 방향으로 역행하지 않음
- 수체 폴리곤과 해안 ribbon의 경계 일치
- 수면·바닥·충돌 수심 일치
- 조사 패드와 필수 경로 의도치 않은 침수 0
- 물 없는 청크의 water update·draw 비용 0

### 13.4 절벽·자산 테스트

- GLB node·LOD·collision·socket 계약
- glTF Validator
- LOD별 bounds·pivot 일치
- 절벽 모듈 연결 seam과 검은 틈
- 충돌 오차와 build exclusion
- 반복 heatmap과 네 방향 실루엣

### 13.5 동굴 테스트

- 포털 footprint의 렌더·충돌 제거 일치
- 지표·하늘 누출 0
- room과 adjacent-room culling
- 지상에서 동굴 렌더 비용 0
- 컨베이어 통과와 대형 설비 clearance 거부
- HUD 없이 출구와 심층 방향 식별

### 13.6 시각·성능 회귀

- 고정 카메라 PNG 비교
- 30초 p50·p95·p99 프레임 기록
- 5분 왕복 이동 뒤 `renderer.info.memory` 회귀
- 시작 시 생성된 지형 geometry 수
- 활성·retained·evicted 청크 수
- 드로우콜, 삼각형, GPU 텍스처 메모리

초기 성능 목표:

- 고품질 데스크톱: 60fps
- 저품질: 30fps 이상
- 고정 스트레스 장면: p95 16.7ms 목표는 P1 기준선 측정 후 확정
- 512m 가시 셸 확장은 256m 섹터에서 메모리 증가가 안정된 뒤 허용

---

## 14. 기술 결정과 보류

### 확정

- 32m 청크와 65/33/17 격자를 유지한다.
- 높이, 충돌과 건설 판정은 같은 결정적 샘플러를 사용한다.
- 원형 편집 스트로크를 장기 런타임 원본으로 사용하지 않고 타일로 베이크한다.
- 실제 청크 풀링을 월드 확장 전에 구현한다.
- 높이장과 절벽·동굴 메시의 책임을 분리한다.
- 수계는 호수 polygon, 하천 spline과 폭포 asset으로 분리한다.
- CPU gameplay mask와 GPU KTX2 render mask를 분리한다.
- GLB의 LOD, collision, socket과 extras를 런타임 계약으로 사용한다.
- 모든 GPU 자원은 명시적으로 dispose한다.

### P1 이후 확정

- 실제 활성 LOD 반경과 히스테리시스 값
- Worker 수와 청크 생성 우선순위
- 절벽의 `runtime_shared` 대 `gltf_pbr` 재질 정책
- 지형 청크당 최종 메모리 예산
- 절벽 spline 배치의 자동 변형 허용 범위
- 동굴 셸의 병합 단위와 portal culling 구현

### 보류

- Geometry Clipmaps
- 자유 복셀 굴착
- 런타임 침식
- 완전한 유체 시뮬레이션
- 수 km 플레이 가능 월드

---

## 15. 기술 출처

- [Three.js LOD](https://threejs.org/docs/pages/LOD.html)
- [Three.js KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html)
- [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)
- [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)
- [Three.js 자원 해제 가이드](https://threejs.org/manual/en/how-to-dispose-of-objects.html)
- [Khronos glTF 2.0 좌표·단위 규격](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units)
- [Khronos glTF Validator](https://github.com/KhronosGroup/glTF-Validator)
- [Khronos KTX](https://www.khronos.org/ktx/)
- [Blender glTF exporter](https://docs.blender.org/manual/en/3.3/addons/import_export/scene_gltf2.html)
- [Blender Geometry Nodes](https://docs.blender.org/manual/en/latest/modeling/geometry_nodes/index.html)
- [MDN Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
- [Priority-Flood 논문](https://doi.org/10.1016/j.cageo.2013.04.024)
- [Geometry Clipmaps](https://hhoppe.com/proj/geomclipmap/)
