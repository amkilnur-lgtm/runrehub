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
// part="cycle" — наверху под «Состоянием» (пропуск цикла важнее), part="labs" — анализы и добавки внизу страницы
export function CoachHealthBlock({ athleteId, part }: { athleteId: number; part: "cycle" | "labs" }) {
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
  if (!data || !data.shared) return null;
  if (part === "cycle" && !data.cycle) return null;
  if (part === "labs" && !data.lab_files.length && !data.supplements.length) return null;
  const showLabs = part === "labs";
  const showCycle = part === "cycle";
  return (
    <div>
      <div className="ds-grp">
        <span>Здоровье</span>
        <span>
          {showLabs && data.lab_files[0] ? `анализы ${labDate(data.lab_files[0].taken_on)}` : showCycle ? "цикл" : ""}
        </span>
      </div>
      <div className="ds-list">
        {showLabs ? <LabFileList files={data.lab_files} /> : null}
        {showLabs && data.supplements.length ? (
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
        {showCycle && data.cycle ? (
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
