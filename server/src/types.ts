export type AppRole = "admin" | "trainer" | "athlete";

export type AuthUser = {
  id: number;
  username: string;
  fullName: string;
  role: AppRole;
  coachId: number | null;
};
