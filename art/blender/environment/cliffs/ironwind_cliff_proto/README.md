# Ironwind cliff prototype

FactoryX 철풍 단층지의 첫 회색 지형 키트다. 재질 디테일보다 12m급 수직 실루엣, 큰 층리, 접지와 반복 연결 규약을 검증한다.

## 포함 자산

- `ironwind_cliff_straight_16m`: 길이 16m 직선 단층벽
- `ironwind_cliff_outer_corner`: 두 직선이 90도로 만나는 바깥 코너
- `ironwind_natural_arch`: 폭 16m, 약 8m 폭의 통과 공간을 가진 자연 아치

각 GLB에는 다음 노드와 glTF `extras`가 들어 있다.

- `VIS_LOD0`, `VIS_LOD1`, `VIS_LOD2`
- `COL_WALL`
- 직선과 코너의 `COL_WALKABLE`
- `SOCKETS` 아래 `cliff.start`, `cliff.end`, `cliff.top`, `cliff.bottom`, `talus.attach`
- 아치의 추가 `cave.portal`
- `META`

Blender 원본은 Blender 표준인 Z-up이며 `1 Blender unit = 1m`다. GLB 내보내기 과정에서 오른손 좌표계, `+Y` up으로 변환된다. 모든 모듈의 피벗은 지면 중앙에 있다.

## 재생성 및 검증

```powershell
./art/blender/environment/cliffs/ironwind_cliff_proto/build.ps1
```

스크립트는 세 개의 `.blend`와 `.glb`, 자산별 네 방향 PNG, `manifest.json`을 생성한 다음 노드·소켓·단위·LOD 감소 계약을 검사한다.

## 프로토타입 범위

현재 충돌은 런타임 통합을 위한 단순 상자 집합이다. 다음 단계에서는 블록아웃 승인 후 오버행, 파손 변형, 접합부 시각 seam, 트라이플래너 재질과 실제 게임 충돌 오차를 다듬는다.
