import { AthleteFeed } from "../components/AthleteFeed";

export function TrainerFeedPage({ viewer = "trainer" }: { viewer?: "trainer" | "athlete" }) {
  return (
    <div className="page-stack feed-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{viewer === "trainer" ? "Лента группы" : "Лента клуба"}</h1>
          <p className="page-subtitle">
            {viewer === "trainer" ? "Все пробежки ваших спортсменов, сначала новые" : "Пробежки всей группы, сначала новые"}
          </p>
        </div>
      </div>
      <AthleteFeed viewer={viewer} />
    </div>
  );
}
