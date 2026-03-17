import { FormEvent, useEffect, useState } from "react";

import { api } from "../api";

type AdminUser = {
  id: number;
  username: string;
  full_name: string;
  role: string;
  coach_id: number | null;
  coach_name: string | null;
};

type Trainer = {
  id: number;
  full_name: string;
};

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [form, setForm] = useState({
    fullName: "",
    username: "",
    password: "",
    role: "trainer",
    coachId: ""
  });

  async function load() {
    const [usersData, trainersData] = await Promise.all([
      api<{ users: AdminUser[] }>("/api/admin/users"),
      api<{ trainers: Trainer[] }>("/api/admin/trainers")
    ]);
    setUsers(usersData.users);
    setTrainers(trainersData.trainers);
  }

  useEffect(() => {
    void load();
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        fullName: form.fullName,
        username: form.username,
        password: form.password,
        role: form.role,
        coachId: form.role === "athlete" && form.coachId ? Number(form.coachId) : null
      })
    });
    setForm({ fullName: "", username: "", password: "", role: "trainer", coachId: "" });
    await load();
  }

  return (
    <div className="grid two-columns">
      <section className="card">
        <h2>Создать учетку</h2>
        <form className="form" onSubmit={onSubmit}>
          <label>
            Имя
            <input
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
          </label>
          <label>
            Логин
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </label>
          <label>
            Пароль
            <input
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <label>
            Роль
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value, coachId: "" })}
            >
              <option value="trainer">Тренер</option>
              <option value="athlete">Спортсмен</option>
            </select>
          </label>
          {form.role === "athlete" ? (
            <label>
              Тренер
              <select
                value={form.coachId}
                onChange={(e) => setForm({ ...form, coachId: e.target.value })}
              >
                <option value="">Выбери тренера</option>
                {trainers.map((trainer) => (
                  <option key={trainer.id} value={trainer.id}>
                    {trainer.full_name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button className="primary-button">Создать</button>
        </form>
      </section>

      <section className="card">
        <h2>Пользователи</h2>
        <div className="list">
          {users.map((user) => (
            <div key={user.id} className="list-row">
              <div>
                <strong>{user.full_name}</strong>
                <div className="muted">@{user.username}</div>
              </div>
              <div className="align-right">
                <div className="role-badge">{user.role}</div>
                {user.coach_name ? <div className="muted">Тренер: {user.coach_name}</div> : null}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
