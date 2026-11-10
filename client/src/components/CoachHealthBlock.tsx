import { useApi } from "../hooks/useApi";
import { LabHistory, labDate, type LabSession, type Supplement } from "./HealthSection";

// Тренеру: анализы и добавки спортсмена — только если он дал согласие и не закрыл раздел
export function CoachHealthBlock({ athleteId }: { athleteId: number }) {
  const { data } = useApi<{ shared: false } | { shared: true; labs: LabSession[]; supplements: Supplement[] }>(
    `/api/trainer/athletes/${athleteId}/health`
  );
  if (!data || !data.shared || (!data.labs.length && !data.supplements.length)) return null;
  return (
    <div>
      <div className="ds-grp">
        <span>Здоровье</span>
        <span>{data.labs[0] ? `анализы ${labDate(data.labs[0].taken_on)}` : ""}</span>
      </div>
      <div className="ds-list">
        <LabHistory labs={data.labs} />
        {data.supplements.length ? (
          <div className="ds-li">
            <div className="ds-m">
              <b>Принимает</b>
              <span style={{ whiteSpace: "normal" }}>
                {data.supplements.map((item) => `${item.name}${item.dose ? ` (${item.dose})` : ""}`).join(", ")}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
