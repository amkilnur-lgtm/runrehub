export type AppRole = "admin" | "trainer" | "athlete";

export type User = {
  id: number;
  username: string;
  fullName: string;
  role: AppRole;
  coachId: number | null;
};
