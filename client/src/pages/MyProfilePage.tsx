import { useEffect, useState } from "react";

import { api } from "../api";
import { useAuth } from "../components/AuthProvider";
import { HealthSection } from "../components/HealthSection";
import { BirthdayDialog } from "../components/BirthdayDialog";
import { useToast } from "../components/ToastProvider";
import { UserAvatar } from "../components/UserAvatar";
import { forgetApiCache, useApi } from "../hooks/useApi";

// «Мой профиль» — слой «Видно клубу» (отчёт «Личный профиль и здоровье»):
// день рождения, разряд ЕВСК, достижения, о себе, метка «Восстанавливаюсь».
// Медицинские данные (травмы, анализы, цикл) — отдельным слоем после согласия, пока не делаем.

type Profile = {
  about: string | null;
  sport_rank: string | null;
  sport_rank_discipline: string | null;
  sport_rank_year: number | null;
  rank_label: string | null;
  recovering: boolean;
  birthday: { day: number; month: number; hidden: boolean } | null;
  achievements: { id: number; title: string; year: number | null }[];
};

const RANKS = [
  ["МСМК", "МСМК"],
  ["МС", "МС"],
  ["КМС", "КМС"],
  ["I", "I разряд"],
  ["II", "II разряд"],
  ["III", "III разряд"],
  ["I юн", "I юношеский"],
  ["II юн", "II юношеский"],
  ["III юн", "III юношеский"],
] as const;
const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

export function MyProfilePage() {
  const { user } = useAuth();
  const showToast = useToast();
  const { data, refresh } = useApi<Profile>("/api/auth/profile");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [about, setAbout] = useState("");
  const [birthdayOpen, setBirthdayOpen] = useState(false);
  const [rankOpen, setRankOpen] = useState(false);
  const [achTitle, setAchTitle] = useState("");
  const [achYear, setAchYear] = useState("");

  useEffect(() => {
    if (data) {
      setProfile(data);
      setAbout(data.about ?? "");
    }
  }, [data]);

  async function save(patch: Partial<Profile>) {
    if (!profile) return;
    const next = { ...profile, ...patch };
    try {
      const saved = await api<Profile>("/api/auth/profile", {
        method: "PUT",
        body: JSON.stringify({
          about: next.about,
          sport_rank: next.sport_rank,
          sport_rank_discipline: next.sport_rank_discipline,
          sport_rank_year: next.sport_rank_year,
          recovering: next.recovering,
        }),
      });
      setProfile(saved);
      forgetApiCache("/api/athlete");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Не удалось сохранить",
      );
    }
  }

  async function addAchievement() {
    if (achTitle.trim().length < 2) return;
    try {
      const saved = await api<Profile>("/api/auth/achievements", {
        method: "POST",
        body: JSON.stringify({
          title: achTitle.trim(),
          year: achYear ? Number(achYear) : null,
        }),
      });
      setProfile(saved);
      setAchTitle("");
      setAchYear("");
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Не удалось добавить",
      );
    }
  }

  async function removeAchievement(id: number) {
    const saved = await api<Profile>(`/api/auth/achievements/${id}`, {
      method: "DELETE",
    });
    setProfile(saved);
  }

  if (!profile || !user)
    return (
      <div className="ds-screen">
        <div
          className="skeleton-block"
          style={{ height: 320, borderRadius: 16 }}
        />
      </div>
    );

  return (
    <div className="ds-screen me">
      <header className="mate-head">
        <UserAvatar
          fullName={user.fullName}
          avatarUrl={user.avatarUrl}
          className="mate-av"
        />
        <div>
          <h1>{user.fullName}</h1>
          <span>фото меняется по нажатию на аватар в шапке</span>
        </div>
      </header>

      <div>
        <div className="ds-grp">
          <span>Видно клубу</span>
          <span>одногруппники и тренер</span>
        </div>
        <div className="ds-list">
          <button
            type="button"
            className="ds-li me-row"
            onClick={() => setBirthdayOpen(true)}
          >
            <div className="ds-m">
              <b>День рождения</b>
              <span>
                {profile.birthday?.hidden
                  ? "клубу не показывается"
                  : "только день и месяц"}
              </span>
            </div>
            <span className="me-v">
              {profile.birthday
                ? `${profile.birthday.day} ${MONTHS[profile.birthday.month - 1]}`
                : "указать"}
            </span>
          </button>

          <button
            type="button"
            className="ds-li me-row"
            aria-expanded={rankOpen}
            onClick={() => setRankOpen((value) => !value)}
          >
            <div className="ds-m">
              <b>Разряд или звание</b>
              <span>по ЕВСК: разряд, дисциплина, год</span>
            </div>
            <span className="me-v">{profile.rank_label ?? "указать"}</span>
          </button>
          {rankOpen ? (
            <div className="me-edit">
              <select
                value={profile.sport_rank ?? ""}
                onChange={(event) =>
                  void save({ sport_rank: event.target.value || null })
                }
                aria-label="Разряд"
              >
                <option value="">нет</option>
                {RANKS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {profile.sport_rank ? (
                <>
                  <input
                    defaultValue={profile.sport_rank_discipline ?? ""}
                    placeholder="дисциплина: марафон, 10 км…"
                    maxLength={60}
                    onBlur={(event) =>
                      void save({
                        sport_rank_discipline:
                          event.target.value.trim() || null,
                      })
                    }
                    aria-label="Дисциплина"
                  />
                  <input
                    defaultValue={profile.sport_rank_year ?? ""}
                    placeholder="год"
                    inputMode="numeric"
                    maxLength={4}
                    onBlur={(event) => {
                      const year = Number(event.target.value);
                      void save({
                        sport_rank_year:
                          year >= 1950 && year <= 2100 ? year : null,
                      });
                    }}
                    aria-label="Год присвоения"
                  />
                </>
              ) : null}
              <p className="me-note">
                Звания — навсегда, КМС — на 3 года, разряды — на 2 года.
                Истёкший разряд покажем с годом.
              </p>
            </div>
          ) : null}

          <div className="ds-li me-col">
            <div className="ds-m">
              <b>Достижения</b>
              <span>места на стартах, титулы — до 10</span>
            </div>
            {profile.achievements.map((item) => (
              <div key={item.id} className="me-ach">
                <span>
                  {item.title}
                  {item.year ? ` · ${item.year}` : ""}
                </span>
                <button
                  type="button"
                  aria-label={`Удалить «${item.title}»`}
                  onClick={() => void removeAchievement(item.id)}
                >
                  ×
                </button>
              </div>
            ))}
            {profile.achievements.length < 10 ? (
              <div className="me-ach-add">
                <input
                  value={achTitle}
                  onChange={(event) => setAchTitle(event.target.value)}
                  placeholder="Казанский марафон — 3 место в категории"
                  maxLength={140}
                />
                <input
                  value={achYear}
                  onChange={(event) =>
                    setAchYear(
                      event.target.value.replace(/\D/g, "").slice(0, 4),
                    )
                  }
                  placeholder="год"
                  inputMode="numeric"
                />
                <button
                  type="button"
                  className="ds-btn ds-btn-3"
                  disabled={achTitle.trim().length < 2}
                  onClick={() => void addAchievement()}
                >
                  Добавить
                </button>
              </div>
            ) : null}
          </div>

          <div className="ds-li me-col">
            <div className="ds-m">
              <b>О себе</b>
              <span>до 500 знаков</span>
            </div>
            <textarea
              value={about}
              maxLength={500}
              rows={3}
              placeholder="Сколько бегаете, к чему готовитесь, что любите"
              onChange={(event) => setAbout(event.target.value)}
              onBlur={() =>
                about.trim() !== (profile.about ?? "") &&
                void save({ about: about.trim() || null })
              }
            />
          </div>

          <label className="ds-li me-row">
            <div className="ds-m">
              <b>Восстанавливаюсь</b>
              <span>клуб увидит метку без подробностей</span>
            </div>
            <input
              type="checkbox"
              className="me-switch"
              checked={profile.recovering}
              onChange={(event) =>
                void save({ recovering: event.target.checked })
              }
            />
          </label>
        </div>
      </div>

      <HealthSection />

      {birthdayOpen ? (
        <BirthdayDialog
          endpoint="/api/auth/birthday"
          initial={
            profile.birthday ?? { day: null, month: null, hidden: false }
          }
          onClose={() => setBirthdayOpen(false)}
          onSaved={() => refresh()}
        />
      ) : null}
    </div>
  );
}
