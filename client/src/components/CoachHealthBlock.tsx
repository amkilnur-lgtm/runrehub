import { useApi } from "../hooks/useApi";
import { LabFileList, type LabFile } from "./LabFiles";
import {
  labDate,
  type LabSession,
  type Supplement,
} from "./HealthSection";

type CoachCycle = {
  day: number | null;
  avg_length: number | null;
  next_in_days: number | null;
  alert: boolean;
} | null;

// Тренеру: анализы и добавки спортсмена — только если он дал согласие и не закрыл раздел
export function CoachHealthBlock({ athleteId }: { athleteId: number }) {
  const { data } = useApi<
    | { shared: false }
    | {
        shared: true;
        labs: LabSession[];
        lab_files: LabFile[];
        supplements: Supplement[];
        cycle: CoachCycle;
      }
  >(`/api/trainer/athletes/${athleteId}/health`);
  if (
    !data ||
    !data.shared ||
    (!data.lab_files.length && !data.supplements.length && !data.cycle)
  )
    return null;
  return (
    <div>
      <div className="ds-grp">
        <span>Здоровье</span>
        <span>
          {data.lab_files[0] ? `анализы ${labDate(data.lab_files[0].taken_on)}` : ""}
        </span>
      </div>
      <div className="ds-list">
        <LabFileList files={data.lab_files} />
        {data.supplements.length ? (
          <div className="ds-li">
            <div className="ds-m">
              <b>Принимает</b>
              <span style={{ whiteSpace: "normal" }}>
                {data.supplements
                  .map(
                    (item) =>
                      `${item.name}${item.dose ? ` (${item.dose})` : ""}`,
                  )
                  .join(", ")}
              </span>
            </div>
          </div>
        ) : null}
        {data.cycle ? (
          <div className="ds-li">
            <div className="ds-m">
              <b>Цикл{data.cycle.day ? ` · день ${data.cycle.day}` : ""}</b>
              <span style={{ whiteSpace: "normal" }}>
                {data.cycle.alert
                  ? "месячных нет больше 3 месяцев — бережнее с объёмом, предложите показаться врачу"
                  : data.cycle.avg_length
                    ? `в среднем ${data.cycle.avg_length} дней`
                    : "мало отметок для средней длины"}
              </span>
            </div>
            {data.cycle.alert ? (
              <span className="ds-pill ds-pill-warn">внимание</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
