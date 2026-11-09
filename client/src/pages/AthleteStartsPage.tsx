import { useAuth } from "../components/AuthProvider";
import { ResultsPanel } from "../components/Results";

export function AthleteStartsPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="ds-screen">
      <ResultsPanel athleteId={user.id} viewer="self" title="Старты" />
    </div>
  );
}
