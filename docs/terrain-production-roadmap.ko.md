# FactoryX 지형 제작 로드맵

> - 문서 상태: 작업 분해 v0.1
> - 목적: 지형 연구와 기술 설계를 실행 가능한 작업 패키지, 의존성, 산출물과 완료 기준으로 변환한다.
> - 상위 계획: `terrain-worldbuilding-plan.ko.md`
> - 기술 계약: `terrain-technical-architecture.ko.md`
> - 레퍼런스 근거: `terrain-reference-research.ko.md`

---

## 1. 실행 원칙

1. 형태를 승인하기 전에 텍스처와 대량 소품을 만들지 않는다.
2. 256m 핵심 섹터에서 품질과 성능을 증명하기 전에 월드를 확장하지 않는다.
3. 각 단계는 눈으로 확인할 산출물과 자동 검사할 완료 기준을 함께 가진다.
4. 지형, 공장 건설, 자원과 물류 경로를 같은 화면에서 검토한다.
5. World Studio, Blender와 Three.js가 같은 좌표·단위·ID·버전 계약을 사용한다.
6. 단계 번호는 기능 수가 아니라 의존성 순서를 뜻한다.
7. 완료되지 않은 고급 요소는 억지로 끼워 넣지 않고 TODO로 남긴다.

---

## 2. 전체 의존성

```text
P0 연구·토폴로지 잠금
  ↓
P1 철풍 단층지 수직 슬라이스
  ↓ 형태 승인
P2 World Source v3 ──────────────┐
P3 지형 샘플러·청크 스트리밍 ──┼─ 기술 기반 병렬 작업
P4 Blender 절벽·아치 키트 ─────┘
  ↓ 통합 승인
P5 수계 ───────────────┐
P6 동굴 수직 슬라이스 ─┘ 부분 병렬 가능
  ↓
P7 바이옴 재질·자연물 군집
P8 원경·맑은 하늘·대기 원근
  ↓
P9 섹터 확장·최적화·저장 마이그레이션
```

현재 진행 대상은 **P1 형태 보강, P2 데이터 계약과 P4 절벽 키트 통합**이다. P5 이후는 이 세 축의 통합 검수 전에는 대규모 구현하지 않는다.

### 2026-08-02 구현 상태

- 완료: 철풍 단층지의 결정론적 매크로 높이장, 22m 단층, 하부·상부 건설 테라스
- 완료: 10m 차량 물류 회랑과 3m 보행 지름길, 기존 자원 앵커 접근성 회귀 검사
- 완료: 고정 검수 카메라 8개와 World Studio의 철풍 하부·상부·아치 접근 버튼
- 완료: Blender 절벽 직선·외곽 코너·자연 아치·아치 전이·붕괴벽·talus 6종과 LOD·충돌·소켓 검증
- 완료: 절벽 직선 3개·붕괴벽 1개·아치 전이 1개·외곽 코너 1개·차량 회랑 자연 아치 1개·talus 3개의 결정적 런타임 배치와 GLB 레지스트리 연결
- 완료: GLB `COL_WALL`을 1인칭 이동계의 높이 필터·벽면 슬라이딩·아치 통과 판정에 연결
- 완료: 거리 LOD 히스테리시스, 결정적 색·두께 변주와 World Studio `절벽 소켓` 오버레이
- 검수 결과: 아치 차량 통로와 붕괴벽 보행 지름길이 유지되고, GLB 6종이 런타임에서 로드되며 25청크 기준 145 draw call·약 232k triangle로 예산 안에 든다.
- TODO: 내부 코너·상단 cap, talus 건설 배제 판정 연결, 접합 오차 heatmap, 절벽 triplanar 재질

즉, **P0 검수 기반, P1-A/B/C 회색 블록아웃과 P4 플레이 가능한 절벽 통합이 구현됐다.** 다음 형태 승인에서는 상단 cap과 내부 코너의 필요성, 절벽 기부 반복감과 재질 방향을 우선 판단한다.

---

## 3. P0 — 연구와 토폴로지 잠금

### 목표

텍스처와 소품 없이 첫 섹터의 큰 형태, 건설 여백, 물류 경로와 검수 방법을 고정한다.

### 작업

#### P0-A 레퍼런스 보드

- Satisfactory 분지·단층·아치·동굴 레퍼런스 분류
- No Man's Sky 원경 실루엣
- Subnautica 수직 바이옴과 동굴 전이
- Death Stranding 경사·우회·여백
- 현실 단층, 절벽 기부와 집수 지형 사진
- 가져올 요소와 피할 요소 표시

산출물:

- 주제별 레퍼런스 링크와 캡션
- `terrain-reference-research.ko.md`

완료 기준:

- 각 이미지에 “무엇을 참고하는지”가 한 문장으로 적혀 있다.
- 원작의 스타일 복제가 아니라 형태·경로·거리층 규칙으로 해석돼 있다.

#### P0-B 첫 섹터 탑뷰

- 256×256m 경계
- 바람유리 분지와 철풍 단층지 영역
- 흑수 습지 경계 또는 예고 구간
- 주요 공장 테라스 3개
- 전초기지 후보 2~4개
- 자원 노드와 보호 반경
- 차량 순환로와 보행 지름길
- 절벽 띠 2~4개
- 수계와 동굴 입구
- 원경 랜드마크 방향

산출물:

- 흑백 탑뷰 1장
- 높이대가 표시된 컬러 토폴로지 맵 1장

완료 기준:

- 텍스트 설명 없이도 공장 후보지와 주요 통로를 찾을 수 있다.
- 모든 필수 자원에서 주 공장까지 최소 한 경로가 있다.

#### P0-C 단면도

- 철풍 단층지 하부·상부 테라스
- 단층벽 높이와 절벽 메시 영역
- 차량 우회로 경사
- 보행 지름길과 자연 아치
- 미래 철도·벨트·파이프 후보선
- 동굴 또는 수계와의 수직 관계

산출물:

- 주 단면 2장 이상

완료 기준:

- 높이장, 절벽 메시와 충돌의 책임이 구분된다.
- 25m급 단층벽이 실제 플레이어·건물 크기와 비교되어 있다.

#### P0-D 검수 카메라

저장할 최소 카메라:

1. 시작 지점 1인칭
2. 분지 중앙 탑뷰
3. 단층 하부에서 상부를 보는 화면
4. 상부 전망대에서 공장을 내려다보는 화면
5. 자연 아치 통과 전
6. 자연 아치 통과 후
7. 수계 또는 습지 경계
8. 원경 비스타

카메라 데이터:

- position, rotation, FOV
- time of day, weather, fog
- quality profile
- 기대 랜드마크와 가려지면 안 되는 대상

완료 기준:

- 현재 기준과 새 블록아웃을 같은 조건으로 비교할 수 있다.

### P0 완료 게이트

- 흑백 탑뷰 승인
- 주 단면 승인
- 카메라 6~8개 저장
- 자원·공장·차량 경로 충돌 없음
- 첫 수직 슬라이스 범위 동결

---

## 4. P1 — 철풍 단층지 수직 슬라이스

### 목표

Satisfactory에서 참고한 웅장함, 공장 건설성과 물류 선택이 하나의 실제 플레이 구역에서 공존하는지 증명한다.

### 범위

- 25m급 주 단층벽 1개
- 하부·상부 공장 테라스 2개
- 차량 우회로 1개
- 짧고 위험한 보행 지름길 1개
- 미래 벨트·철도 회랑
- 자연 아치 1개
- 지역 랜드마크 1개
- 회색 낙석·절벽 기부 블록

### 작업

#### P1-A 매크로 블록아웃

- 기존 글로벌 노이즈의 진폭을 임시로 낮춤
- 단층 상단과 하단을 큰 평면 형태로 배치
- 중간 테라스와 골짜기 형성
- 실루엣을 방해하는 원뿔·기둥 제거 또는 숨김

#### P1-B 공장 테라스

- 하부와 상부의 실제 건설 면적 측정
- 자원 노드와 출입구 연결
- 정사각형 플랫폼처럼 보이지 않는 자연 경계
- 4~8m 완충·전이 띠

#### P1-C 이동망

- 8~12m 차량 우회로
- 2~4m 보행 지름길
- 벨트 리프트와 파이프 상승 후보
- 미래 철도 곡률과 경사 예비 검토
- 막다른 길과 통과 불가능한 가짜 길 제거

#### P1-D 시야와 랜드마크

- 단층 하부에서 상단 일부가 보이게 함
- 아치가 진행 방향을 프레이밍하도록 배치
- 아치 통과 후 공장 또는 원경이 공개되게 함
- 랜드마크 주변 밀도 낮춤
- 맑은 하늘이 화면 상단에 충분히 보이게 함

#### P1-E 플레이 테스트

- 1인칭 보행
- 탑뷰 카메라 이동
- 차량 또는 차량 크기 프록시 통과
- 벨트·파이프 임시 연결
- 건설 가능 판정과 보이는 평지 비교

### 산출물

- 흑백 또는 회색 월드 블록아웃
- 고정 카메라 스크린샷 6~8장
- 탑뷰 경로 오버레이
- 플레이어·차량·건물 스케일 비교 이미지
- 문제 목록과 승인 결정

### 완료 기준

- 재질과 식생 없이도 철풍 단층지로 인식된다.
- 플레이어 위치에서 단층 상·하단과 이동 가능한 틈이 함께 읽힌다.
- 차량 경로가 막히지 않고 아치 통과 폭이 충분하다.
- 공장 테라스가 자연스럽지만 실제 건설 면적을 확보한다.
- 적어도 세 카메라에서 전경·중경·원경이 분리된다.
- 원뿔과 작은 암석을 제거해도 장소 정체성이 유지된다.
- 중대한 성능 회귀가 없다.

### P1에서 아직 하지 않는 것

- 최종 텍스처
- 대량 식생과 암석 산포
- 전체 절벽 키트
- 완성 수계와 동굴
- 512m 플레이 가능 확장

---

## 5. P2 — World Source v3와 World Studio

### 목표

승인된 블록아웃을 코드 상수와 localStorage 스트로크가 아닌 버전 관리 가능한 토폴로지 데이터로 저장한다.

### 작업 패키지

#### P2-A 데이터 계약

- `WorldSourceV3` TypeScript 타입
- JSON Schema 또는 동등한 런타임 validator
- stable ID, priority와 operation
- 좌표, 단위, 경계와 sample 규칙
- generator version과 content hash

#### P2-B v2 마이그레이션

- 기존 원형 스트로크를 `legacySculptLayer`로 이동
- 랜드마크 오프셋과 환경 설정 보존
- v2→v3 roundtrip fixture
- 실패 시 원본을 손상시키지 않는 명확한 오류

#### P2-C 편집 도구

- macro shape
- spline과 polygon
- 선택, 이동, control point 편집
- 레이어 보임·잠금·순서
- undo/redo
- dirty bounds 표시

#### P2-D 검수 기능

- mixed LOD overlay
- buildability·resource overlay
- water depth·flow
- cliff band와 socket
- cave portal과 room
- 저장 가능한 review camera

#### P2-E 파일 입출력

- source JSON import/export
- strict validation
- deterministic bake manifest
- localStorage는 임시 draft로만 사용

### 산출물

- 타입과 parser
- 스키마·fixture
- v2 migration
- 예제 `ironwind` source
- World Studio 편집 UI

### 완료 기준

- export→import 손실 0
- 같은 source/version/seed의 bake hash 동일
- 중복 ID, 잘못된 polygon, 끊긴 spline과 범위 밖 데이터 자동 거부
- undo/redo와 재로드 후 결과 동일
- World Studio와 게임이 같은 parser 사용

### 2026-08-02 구현 상태

- 완료: `WorldSourceV3` strict import/export, canonical JSON과 SHA-256 content hash
- 완료: World Studio에서 v2 작업본과 v3 source를 명확히 분리한 파일 입출력·검증 오류 요약·hash 표시
- 완료: 불러온 v3 source는 검증된 작업 메모리로만 보관하고 bake 전 렌더 지형을 교체하지 않는 안전 경계
- TODO: macro/spline/polygon control-point 편집, 레이어 잠금·순서, undo/redo와 dirty bounds 시각화

---

## 6. P3 — 지형 샘플러와 실제 청크 스트리밍

### 목표

새 월드 데이터를 실제 높이, 충돌, 건설 판정과 안정적인 LOD로 변환한다.

### 작업 패키지

#### P3-A 매크로 형태 합성

- basin, plateau, ridge, fault-step
- canyon, crater-ring, sinkhole와 saddle
- add, max, carve와 smooth union
- 바이옴과 gameplay tag

#### P3-B 샘플러

- source·bake 데이터를 읽는 권위 샘플러
- 높이, 법선, 경사, biome, surface와 buildability
- 자원 패드와 route 제약
- 결정적 noise detail

#### P3-C Worker 베이크

- 청크별 position·normal·mask array
- transferable `ArrayBuffer`
- terrain revision과 stale response 취소
- 1표본 halo
- 부분 dirty rebuild

#### P3-D 청크 풀

- unloaded→requested→sampled→uploaded→active→retained→evicted
- LRU 또는 동등한 보존 정책
- 새 LOD 준비 전 이전 LOD 유지
- eviction 시 명시적 dispose

#### P3-E mixed LOD

- 인접 LOD 차이 최대 1
- shared edge·skirt 검사
- 히스테리시스
- LOD0↔1, LOD1↔2 테스트

#### P3-F 품질 모드

- high와 low의 활성 반경
- 실제 지형 해상도와 산포 밀도 전환
- 품질 전환 뒤 오래된 버퍼 정리

### 산출물

- 새 `TerrainSampler`
- Worker bake path
- chunk pool과 diagnostics
- mixed LOD test suite
- 프로파일 결과

### 완료 기준

- 1,000개 경계 표본 높이 오차 1mm 이하 목표
- CPU sampler와 렌더 높이 차 2cm 이하 목표
- mixed LOD 경계 구멍 0
- 고품질 활성 청크 25개 이하
- 왕복 이동 뒤 geometry·texture 수가 계속 증가하지 않음
- 시작 시 64×3 전체 지형 메시를 생성하지 않음
- 같은 source/version/seed의 결과가 결정적임

### 2026-08-02 구현 상태

- 완료: `WorldSourceV3` 매크로 형태 8종과 operation 5종을 평가하는 순수 `WorldSourceSampler`
- 완료: source identity·revision·request ID를 포함한 청크 bake protocol, position·normal·mask transferable buffer와 1표본 halo
- 완료: dirty bounds의 LOD별 부분 rebuild 대상 계산과 stale response 차단
- 완료: 청크 retention·LRU eviction·품질 전환 정리·진단과 mixed LOD 인접 차이 제한·4m 히스테리시스
- 완료: `TerrainRenderer`의 전체 월드 3-LOD 선생성을 제거하고 활성/retained 청크만 생성·eviction 시 geometry dispose
- 검수 결과: P2/P3 관련 회귀 52개 통과, high 25개·low 9개 활성 청크 예산 유지
- TODO: 실제 Web Worker 생성·queue backpressure, bake buffer의 GPU upload 경로, shared-edge heatmap과 장거리 왕복 메모리 프로파일

---

## 7. P4 — Blender 절벽·아치 키트

### 목표

높이장으로 표현할 수 없는 실제 수직성, 오버행과 자연 아치를 런타임 계약과 함께 증명한다.

### 1차 프로토타입

- 16m 직선 절벽
- 안쪽 코너
- 바깥쪽 코너
- top cap
- talus 군집
- 자연 아치

### 작업 패키지

#### P4-A 실루엣

- 128px 검은 썸네일
- 전·후·좌·우·상단 검수
- 플레이어·차량 프록시 비교
- LOD2 블록아웃 우선

#### P4-B 중·근거리 구조

- LOD1 큰 층리, 파단과 기부
- LOD0 챔퍼, 홈과 접합
- 반복 노출을 줄이는 비대칭

#### P4-C 충돌과 소켓

- walkable, wall, build-exclusion
- cliff.start/end/top/bottom
- talus.attach와 cave.portal
- 동일 pivot과 bounds

#### P4-D Export

- GLB와 manifest v2
- custom property→extras
- triangle·bytes 기록
- glTF Validator

#### P4-E 런타임 통합

- cliff band 지형 제거 또는 filler
- spline 배치
- 소켓 연결
- LOD와 hysteresis
- 접합부 블렌드

#### P4-F 반복 검수

- 세 개 이상 연속 배치
- 코너와 붕괴 변형 혼합
- 반복 heatmap
- 다양한 조명과 카메라

### 완료 기준

- 접합 검은 구멍 0
- 시각 seam 5cm 이하 목표
- 보행면 충돌 오차 2cm 이하 목표
- 충돌이 시각 외곽 밖으로 5cm 이상 돌출하지 않음
- LOD 위치 점프 5mm 이하 목표
- 화면상 2px를 넘는 실루엣 pop 없음
- 한 전망에서 동일 모듈 반복이 즉시 읽히지 않음
- glTF Validator 오류 0

---

## 8. P5 — 수계

### 목표

물을 격자 웅덩이가 아니라 지형과 공장 입지를 설명하는 연속 흐름망으로 만든다.

### 첫 수계

```text
철풍 단층 상류 집수부
→ 계절 하천
→ 단층 폭포
→ 바람유리 분지 가장자리 호수 또는 흑수 습지 경계
```

### 작업 패키지

- P5-A WaterBody와 RiverSpline 자료형
- P5-B 하천 carve와 폭포 소켓
- P5-C 호수·습지 polygon
- P5-D shoreline ribbon
- P5-E flow·depth·wetness mask
- P5-F 수면·하천·폭포 셰이더
- P5-G 건설·충돌·위험 판정
- P5-H dirty rebuild와 테스트

### 완료 기준

- 상류에서 하류까지 물의 이동 방향을 눈으로 추적할 수 있음
- 같은 호수의 수위가 일정함
- 하천 고도가 하류 방향으로 역행하지 않음
- 사각 격자 해안선 없음
- 수면, 보이는 바닥과 충돌 수심 일치
- 조사 패드와 필수 접근로 침수 0
- 물이 없는 청크의 water draw·update 비용 0

### 2026-08-02 구현 상태

- 완료: source 기반 lake·marsh·river·waterfall level·bed·depth·3D flow 샘플러
- 완료: 격자와 독립적인 정확한 shoreline ribbon과 결정적 우선순위
- 완료: route·자원 패드·build/resource patch dry exclusion과 침수 회귀 검사
- TODO: 수계 carve를 terrain bake에 연결, 수면·폭포 셰이더, wetness mask GPU upload와 청크별 draw 제거

---

## 9. P6 — 동굴 수직 슬라이스

### 목표

지표와 물류적으로 연결되는 한 개의 동굴을 실제 포털·충돌·컬링과 함께 완성한다.

### 첫 동굴 구조

- 협곡형 지표 입구
- 방 2개
- 회랑 1개
- 넓은 공장 공동 1개
- 지하강 또는 수직 샤프트 1개
- 자원 채굴 구역
- 지상 복귀 루프 또는 지름길

### 작업 패키지

- P6-A CaveGraph와 portal 데이터
- P6-B 입구 전환 GLB
- P6-C 지표 삼각형·충돌 제거
- P6-D room·corridor 셸
- P6-E floor·wall 충돌과 build volume
- P6-F portal culling
- P6-G 조명, fog와 방향 기준
- P6-H 벨트·파이프·소형 차량 clearance

### 완료 기준

- 포털 밖으로 하늘이나 지표가 누출되지 않음
- 입구에서 보이지 않는 지표 충돌에 막히지 않음
- 현재 방과 인접 방 이외 geometry 비활성
- 지상에서 동굴 관련 렌더 비용 거의 0
- 모든 방이 같은 구형 단면으로 반복되지 않음
- 컨베이어는 통과하고 대형 설비는 clearance에 따라 거부됨
- HUD 없이 출구와 심층 방향을 식별할 수 있음

### 2026-08-02 구현 상태

- 완료: source cave room·portal·corridor를 정렬된 불변 runtime view로 변환
- 완료: 포털 footprint·room containment, graph 연결성, build/corridor clearance와 spline grade 검증
- 완료: room/corridor 공간 샘플과 거리 기반 route position API
- TODO: CaveRenderer를 source view로 교체, 입구 전환 GLB·portal culling·지표 충돌 제거와 동굴 조명 검수

---

## 10. P7 — 바이옴 재질과 자연물 군집

### 목표

승인된 형태 위에 지질과 환경 인과를 표현하고 바이옴 전이를 완성한다.

### 작업 패키지

- P7-A CPU gameplay mask
- P7-B GPU KTX2 render mask
- P7-C triplanar·world-space terrain material
- P7-D slope·wetness·exposure 기반 혼합
- P7-E 암석·식생 군집
- P7-F 절벽 기부·하천·공장 접합
- P7-G 반복 heatmap과 exclusion zone
- P7-H KTX2, Meshopt와 인스턴싱 최적화

### 완료 기준

- 색을 제거해도 완성 바이옴이 형태로 구분됨
- 일반 전이 8~24m, 큰 지질 경계 30~50m
- 반복 격자와 동일 회전 패턴 없음
- 절벽 하부에 낙석, 수로에 자갈처럼 배치 원인이 보임
- 공장 패드와 영웅 실루엣의 가독성을 해치지 않음
- 거리별 화면·메모리 예산 통과

---

## 11. P8 — 원경, 하늘과 대기 원근

### 목표

화성처럼 탁한 전역 먼지 대신 맑고 구름 있는 외계 행성의 깊이를 만든다.

### 작업 패키지

- P8-A 80~220m 저해상도 far terrain
- P8-B 220m 이후 ridge·hero 비스타
- P8-C 푸른 기본 하늘과 구름층
- P8-D 구름 그림자와 옅은 대기 원근
- P8-E 습지 저지대 안개
- P8-F 열 균열 증기와 국소 먼지
- P8-G 낮·황혼·날씨별 검수

### 완료 기준

- 기본 맑은 날에 화면 전체를 덮는 먼지 막이 없음
- 모든 검수 카메라에서 월드 끝, 검은 구멍과 빈 수평선 없음
- 원경이 카메라를 따라붙지 않고 안정적인 시차를 가짐
- 원경이 플레이 영역보다 과도하게 선명하거나 상세하지 않음
- 화면의 30~40%에서 맑은 하늘을 볼 수 있는 주요 전망이 존재

---

## 12. P9 — 섹터 확장과 최적화

### 목표

첫 섹터의 품질을 유지하며 256m 섹터를 묶어 더 큰 월드로 확장한다.

### 작업 패키지

- P9-A 섹터 번들·manifest
- P9-B 인접 섹터 높이·법선·바이옴 경계
- P9-C 하천·도로·철도 spline 연결
- P9-D 원경 우선 로드와 자산 캐시
- P9-E 공장·물류 시뮬레이션과 렌더 스트리밍 분리
- P9-F 저장 데이터 월드 버전 마이그레이션
- P9-G 5분 이동 soak test
- P9-H 성능·메모리 예산 동결

### 완료 기준

- 섹터 경계에서 높이, 재질, 수계와 이동로가 끊기지 않음
- 스트리밍 중 공장과 물류 상태가 유실되지 않음
- 5분 왕복 뒤 geometry·texture 메모리 증가 없음
- 압축 전후 normal, tangent와 UV에 치명적 변화 없음
- 첫 섹터의 목표 프레임과 메모리 예산 유지

Geometry Clipmaps는 플레이 가능 지형이 수 km가 되고 현재 섹터 방식이 실제 병목일 때만 재평가한다.

---

## 13. 병렬 작업 트랙

P1 승인 후 다음 트랙을 병렬로 진행할 수 있다.

| 트랙 | 담당 | 선행 조건 | 통합 지점 |
| --- | --- | --- | --- |
| A. World Source | schema, parser, migration, editor | P1 topology 승인 | World Source v3 |
| B. Terrain Runtime | sampler, Worker, chunk pool, LOD | World Source 최소 타입 | baked terrain contract |
| C. Blender Kit | cliff, arch, LOD, collision, sockets | P1 절벽 단면 승인 | Asset Manifest v2 |
| D. QA | camera regression, mixed LOD, memory benchmark | 기준 카메라와 프로파일 | 각 단계 완료 게이트 |

P5 수계와 P6 동굴은 `waterfall socket`, `cave.portal`, 높이장 제거 영역과 충돌 계약을 먼저 동결하면 병렬화할 수 있다.

병렬화하지 않을 것:

- 승인 전 영웅 지형을 여러 명이 서로 다른 비율로 제작
- World Source와 런타임이 서로 다른 좌표·경계 규칙을 독립 설계
- 절벽 GLB와 배치기가 소켓 이름을 별도로 결정
- 수계와 지형 carve가 서로 다른 수위 원본을 사용

---

## 14. 단계별 공통 검수 산출물

각 중요 단계는 다음 파일을 남긴다.

- 탑뷰 전체 지도
- 시작 지점 1인칭
- 단층 하부와 상부 전망
- 자연 아치 통과 전·후
- 물가와 해안
- 동굴 입구와 내부 공동
- 원경 비스타
- 맑은 날과 국소 안개 비교
- 성능 지표 JSON

고정 검수 질문:

1. 128px 흑백에서도 장소가 구별되는가?
2. 전경·중경·원경이 있는가?
3. 공장 테라스가 실제로 충분한가?
4. 차량과 보행 경로가 서로 다른 선택을 제공하는가?
5. 랜드마크가 방향 탐색에 도움 되는가?
6. 물의 상·하류가 연결되는가?
7. 검은 구멍, LOD 틈과 반복 자산이 보이는가?
8. 1인칭 조작과 탑뷰 건설 양쪽에서 읽히는가?

---

## 15. 위험과 대응

| 위험 | 징후 | 대응 |
| --- | --- | --- |
| 블록아웃 전에 고품질 자산 제작 | 예쁜 바위는 많지만 맵은 여전히 평평함 | P1 승인 전 텍스처·대량 자산 금지 |
| 지형 확대를 너무 일찍 시작 | 로딩·메모리 문제와 빈 지역 증가 | 256m 수직 슬라이스와 청크 풀링 우선 |
| 노이즈로 다양성 해결 | 색만 다르고 실루엣은 같음 | 매크로 형태와 수작업 spline 우선 |
| 공장과 지형 설계 분리 | 멋진 절벽이 자원·물류를 막음 | 자원·건설·차량 overlay 상시 표시 |
| 절벽 모듈 반복 | 같은 이음새가 연속 노출 | 코너·붕괴 변형과 반복 heatmap |
| 수계가 공장을 침수 | 수위 변경이 저장 데이터 파괴 | 침수 검사와 월드 버전 정책 |
| 동굴 셸과 지표 충돌 | 구멍, z-fighting, 내부 지표 노출 | portal 차폐와 같은 footprint의 렌더·충돌 제거 |
| 전역 안개 의존 | 맵이 작고 탁해 보임 | 맑은 기본 상태, 국소 안개와 실제 원경 |
| World Studio 데이터 비대화 | 수천 스트로크로 편집 느려짐 | macro·spline·mask 베이크와 compact |
| LOD 후순위 처리 | 확장 뒤 pop과 메모리 급증 | P3에서 실제 풀링과 mixed edge 검증 |
| GLB 계약 불일치 | pivot·collision·material이 매 자산 다름 | Asset Manifest v2와 자동 검증 선행 |

---

## 16. 의사결정 로그

### 확정

- [x] 매크로 월드는 수작업으로 고정한다.
- [x] 노이즈는 중·소형 표면 디테일에 제한한다.
- [x] 절벽, 오버행, 아치와 동굴은 Blender 메시로 분리한다.
- [x] 첫 플레이 영역은 256m 섹터다.
- [x] 첫 수직 슬라이스는 철풍 단층지다.
- [x] 첫 섹터에 여섯 바이옴 전체를 넣지 않는다.
- [x] 맑고 구름 있는 하늘을 기본으로 한다.
- [x] 물은 흐름망과 수체 polygon으로 만든다.
- [x] 자유 복셀 굴착과 실시간 침식은 제외한다.
- [x] 월드 확장 전에 실제 청크 풀링을 구현한다.

### P0에서 확정

- [ ] 철풍 단층지의 위치, 방향과 정확한 단면
- [ ] 첫 섹터의 세 번째 경계 바이옴
- [ ] 자원과 세 개 공장 테라스의 관계
- [ ] 차량·철도의 최대 경사와 회전 반경
- [ ] 자연 아치 통과 폭
- [ ] 원경 비스타 크기와 플레이 불가 경계
- [ ] 고정 검수 카메라

### P2 이전에 확정

- [ ] World Source v3 serialization과 JSON Schema
- [ ] R16 height bake와 macro source의 권위 우선순위
- [ ] 버전 관리 source와 배포 bundle 경로
- [ ] v2 localStorage migration
- [ ] 자원·기존 공장의 월드 버전 정책

### P4 이전에 확정

- [ ] `runtime_shared`와 `gltf_pbr` 재질 정책
- [ ] Blender 전면·진행 방향 규약
- [ ] socket 이름과 transform 추출
- [ ] cliff band 지형 제거 방식
- [ ] 충돌 허용 오차

### 보류 TODO

- [ ] 산업 진행에 따른 식생·습윤·오염 변화
- [ ] 장기 수위 변화
- [ ] 비행 이동수단과 초장거리 시야
- [ ] 파괴 가능한 소형 암석
- [ ] 전체 월드 최종 크기
- [ ] 고급 물 반사와 날씨별 수면
- [ ] 제한된 광산 구역의 굴착 시스템
- [ ] Geometry Clipmaps 재평가 조건

---

## 17. 다음 행동

현재는 다음 순서만 실행한다.

1. 철풍 단층지 탑뷰를 흑백으로 작성한다.
2. 주 단면 2개에서 25m 단층벽과 테라스 높이를 고정한다.
3. 자원, 공장 테라스, 차량로, 보행 지름길과 아치를 한 지도에서 검증한다.
4. World Studio 또는 임시 회색 블록으로 형태를 만든다.
5. 고정 카메라 6~8개에서 기준 스크린샷을 만든다.
6. 실루엣과 동선을 승인한 뒤 `16m 절벽 + 코너 + 아치` Blender 프로토타입을 시작한다.

텍스처, 대량 식생, 전체 동굴, 512m 플레이 영역과 여섯 바이옴 전체 제작은 이 결과가 승인될 때까지 진행하지 않는다.
