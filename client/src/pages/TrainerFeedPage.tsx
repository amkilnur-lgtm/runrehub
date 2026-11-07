import { AthleteFeed } from "../components/AthleteFeed";

export function TrainerFeedPage() {
  return (
    <div className="page-stack feed-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Лента группы</h1>
          <p className="page-subtitle">Все пробежки ваших спортсменов, сначала новые</p>
        </div>
      </div>
      <AthleteFeed viewer="trainer" />
    </div>
  );
}
