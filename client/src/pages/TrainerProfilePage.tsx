import { useState } from "react";

import { useAuth } from "../components/AuthProvider";
import { BirthdayDialog } from "../components/BirthdayDialog";
import { EditableAvatarMenu } from "../components/EditableAvatarMenu";
import { ProfileSettings } from "../components/ProfileSettings";

// Профиль тренера — короткий: фото, день рождения, тема и выход (вход — тап по аватару в шапке)
export function TrainerProfilePage() {
  const { user } = useAuth();
  const [birthdayOpen, setBirthdayOpen] = useState(false);
  if (!user) return null;
  return (
    <div className="ds-screen me">
      <header className="me-top">
        <EditableAvatarMenu fullName={user.fullName} avatarUrl={user.avatarUrl} className="me-photo" variant="photo" />
        <h1>{user.fullName}</h1>
        <span className="me-sub">тренер</span>
      </header>
      <div>
        <div className="ds-grp">
          <span>Видно клубу</span>
        </div>
        <div className="ds-list">
          <button type="button" className="ds-li me-row" onClick={() => setBirthdayOpen(true)}>
            <div className="ds-m">
              <b>День рождения</b>
              <span>только день и месяц</span>
            </div>
            <span className="me-v">›</span>
          </button>
        </div>
      </div>
      <ProfileSettings />
      {birthdayOpen ? <BirthdayDialog endpoint="/api/auth/birthday" onClose={() => setBirthdayOpen(false)} /> : null}
    </div>
  );
}
