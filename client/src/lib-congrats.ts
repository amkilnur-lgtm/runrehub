import { api } from "./api";

// «Поздравить» — лайк последней пробежки: общаемся в чате группы в Telegram, в приложении — короткий знак внимания
export async function congratulate(workoutId: number) {
  await api(`/api/athlete/workouts/${workoutId}/like`, { method: "POST" });
}
