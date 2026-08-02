export type FactoryGuideFacts = Readonly<{
  inspectedPowerCore: boolean;
  hasDistributionPole: boolean;
  hasCoreCable: boolean;
  hasExtractor: boolean;
  hasProcessor: boolean;
  hasProductionConnection: boolean;
  hasFirstProduct: boolean;
}>;

export type FactoryGuideStepId =
  | "inspect_power_core"
  | "build_distribution"
  | "connect_power"
  | "build_extractor"
  | "build_processor"
  | "connect_logistics"
  | "confirm_product"
  | "complete";

export type FactoryGuideInfo = Readonly<{
  step: number;
  total: number;
  id: FactoryGuideStepId;
  title: string;
  instruction: string;
  detail: string;
  completed: boolean;
}>;

const STEPS = [
  {
    id: "inspect_power_core",
    title: "현장 전력 확인",
    instruction: "검사 도구(1)로 현장 전력 코어를 선택하세요.",
    detail: "우측 설비 패널에서 24 MW 용량과 전력 포트를 확인할 수 있습니다.",
    complete: (facts: FactoryGuideFacts) => facts.inspectedPowerCore,
  },
  {
    id: "build_distribution",
    title: "배전 지점 설치",
    instruction: "건설 카탈로그에서 배전 기둥 Mk.1을 코어 8 m 안에 설치하세요.",
    detail: "배전 기둥은 주변 설비로 전력을 나누고 케이블 연결점을 제공합니다.",
    complete: (facts: FactoryGuideFacts) => facts.hasDistributionPole,
  },
  {
    id: "connect_power",
    title: "첫 전력 케이블",
    instruction: "L을 누른 뒤 코어의 전력 포트와 배전 기둥 포트를 차례로 지정하세요.",
    detail: "보라색 포트와 케이블 미리보기가 유효한 연결을 표시합니다.",
    complete: (facts: FactoryGuideFacts) => facts.hasCoreCable,
  },
  {
    id: "build_extractor",
    title: "원료 채취 시작",
    instruction: "광맥 위에 채굴기를 설치하고 배전 범위 안에 두세요.",
    detail: "설치 미리보기의 출력 포트 방향을 다음 설비 쪽으로 맞추세요.",
    complete: (facts: FactoryGuideFacts) => facts.hasExtractor,
  },
  {
    id: "build_processor",
    title: "첫 가공 설비",
    instruction: "아크 제련기를 설치하고 철 주괴 레시피를 확인하세요.",
    detail: "R로 회전해 채굴기 출력과 제련기 입력이 마주보게 배치하세요.",
    complete: (facts: FactoryGuideFacts) => facts.hasProcessor,
  },
  {
    id: "connect_logistics",
    title: "물류 경로 연결",
    instruction: "컨베이어(2)를 채굴기 출력 포트에서 제련기 입력 포트까지 연결하세요.",
    detail: "경로 미리보기와 실제 배치가 같은 셀을 사용하며, 연결선이 이어져야 합니다.",
    complete: (facts: FactoryGuideFacts) => facts.hasProductionConnection,
  },
  {
    id: "confirm_product",
    title: "첫 생산 확인",
    instruction: "제련기를 검사해 출력 버퍼에 첫 제품이 들어오는지 확인하세요.",
    detail: "가동하지 않으면 우측 패널의 전력·입력·출력 원인과 해결 방법을 따르세요.",
    complete: (facts: FactoryGuideFacts) => facts.hasFirstProduct,
  },
] as const;

export const deriveFactoryGuide = (facts: FactoryGuideFacts): FactoryGuideInfo => {
  const index = STEPS.findIndex((step) => !step.complete(facts));
  if (index < 0) {
    return {
      step: STEPS.length,
      total: STEPS.length,
      id: "complete",
      title: "첫 생산선 가동 완료",
      instruction: "프로젝트 도크의 다음 계약을 확인하고 생산선을 확장하세요.",
      detail: "동일한 검사·포트·전력 상태 규칙이 이후 설비에도 적용됩니다.",
      completed: true,
    };
  }
  const current = STEPS[index];
  return {
    step: index + 1,
    total: STEPS.length,
    id: current.id,
    title: current.title,
    instruction: current.instruction,
    detail: current.detail,
    completed: false,
  };
};
