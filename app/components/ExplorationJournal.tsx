import { EXPLORATION_SITES, type ExplorationSnapshot } from "../game/environment/exploration.ts";

export default function ExplorationJournal({
  snapshot,
  onClose,
}: Readonly<{ snapshot: ExplorationSnapshot; onClose: () => void }>) {
  const discovered = new Set(snapshot.discoveredSiteIds);
  return (
    <section className="exploration-overlay" role="dialog" aria-modal="true" aria-label="A-17 탐사 기록">
      <header>
        <div><span>FIELD SURVEY / A-17</span><h2>탐사 기록</h2></div>
        <strong>{discovered.size} / {EXPLORATION_SITES.length}</strong>
        <button type="button" onClick={onClose}>닫기 <kbd>ESC</kbd></button>
      </header>
      <ol>
        {EXPLORATION_SITES.map((site, index) => {
          const known = discovered.has(site.id);
          return (
            <li key={site.id} data-discovered={known}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{known ? site.name : "미확인 측량 신호"}</strong>
                <small>{site.stratumId === "surface" ? "지상" : "열극 심층부"} · {known ? `${site.position.x}, ${site.position.z}` : "좌표 암호화"}</small>
                <p>{known ? site.lore : "현장에 접근해 측량 신호를 복구하세요."}</p>
              </div>
              <em>{known ? site.reward.label : "미발견"}</em>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
