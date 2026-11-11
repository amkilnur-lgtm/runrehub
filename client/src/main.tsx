import React, { lazy } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";

import { AppLayout } from "./components/AppLayout";
import { RequireAuth, RequireRole } from "./components/RequireAuth";
import { AuthProvider } from "./components/AuthProvider";
import { ToastProvider } from "./components/ToastProvider";
import { LoginPage } from "./pages/LoginPage";
import "@fontsource-variable/manrope";
import "@fontsource/unbounded/cyrillic-700.css";
import "@fontsource/unbounded/latin-700.css";
import "./styles.css";
import { installPressFeedback } from "./press";

// Страницы — отдельными частями: старт приложения быстрее, а после первого экрана
// остальные части тихо догружаются, чтобы переходы оставались мгновенными (см. preloadPages)
const pageLoaders = {
  AdminPage: () => import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })),
  TrainerDashboardPage: () => import("./pages/TrainerDashboardPage").then((m) => ({ default: m.TrainerDashboardPage })),
  TrainerAthletePage: () => import("./pages/TrainerAthletePage").then((m) => ({ default: m.TrainerAthletePage })),
  TrainerFeedPage: () => import("./pages/TrainerFeedPage").then((m) => ({ default: m.TrainerFeedPage })),
  TrainerReviewPage: () => import("./pages/TrainerReviewPage").then((m) => ({ default: m.TrainerReviewPage })),
  TrainerStartsPage: () => import("./pages/TrainerStartsPage").then((m) => ({ default: m.TrainerStartsPage })),
  TrainerProfilePage: () => import("./pages/TrainerProfilePage").then((m) => ({ default: m.TrainerProfilePage })),
  TrainerRunsPage: () => import("./pages/TrainerRunsPage").then((m) => ({ default: m.TrainerRunsPage })),
  WorkoutPage: () => import("./pages/WorkoutPage").then((m) => ({ default: m.WorkoutPage })),
  AthleteDashboardPage: () => import("./pages/AthleteDashboardPage").then((m) => ({ default: m.AthleteDashboardPage })),
  AthleteProfilePage: () => import("./pages/AthleteProfilePage").then((m) => ({ default: m.AthleteProfilePage })),
  AthleteProfileRunsPage: () => import("./pages/AthleteProfileRunsPage").then((m) => ({ default: m.AthleteProfileRunsPage })),
  MyProfilePage: () => import("./pages/MyProfilePage").then((m) => ({ default: m.MyProfilePage })),
  AthleteRunsPage: () => import("./pages/AthleteRunsPage").then((m) => ({ default: m.AthleteRunsPage })),
  AthleteStartsPage: () => import("./pages/AthleteStartsPage").then((m) => ({ default: m.AthleteStartsPage })),
};
const AdminPage = lazy(pageLoaders.AdminPage);
const TrainerDashboardPage = lazy(pageLoaders.TrainerDashboardPage);
const TrainerAthletePage = lazy(pageLoaders.TrainerAthletePage);
const TrainerRunsPage = lazy(pageLoaders.TrainerRunsPage);
const TrainerProfilePage = lazy(pageLoaders.TrainerProfilePage);
const TrainerFeedPage = lazy(pageLoaders.TrainerFeedPage);
const TrainerReviewPage = lazy(pageLoaders.TrainerReviewPage);
const TrainerStartsPage = lazy(pageLoaders.TrainerStartsPage);
const WorkoutPage = lazy(pageLoaders.WorkoutPage);
const AthleteDashboardPage = lazy(pageLoaders.AthleteDashboardPage);
const AthleteProfilePage = lazy(pageLoaders.AthleteProfilePage);
const AthleteProfileRunsPage = lazy(pageLoaders.AthleteProfileRunsPage);
const MyProfilePage = lazy(pageLoaders.MyProfilePage);
const AthleteRunsPage = lazy(pageLoaders.AthleteRunsPage);
const AthleteStartsPage = lazy(pageLoaders.AthleteStartsPage);

export function preloadPages() {
  const run = () => Object.values(pageLoaders).forEach((load) => void load().catch(() => undefined));
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (idle) idle(run);
  else window.setTimeout(run, 1200);
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <LoginPage />
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            element: <RequireRole roles={["admin"]} />,
            children: [{ path: "/admin", element: <AdminPage /> }]
          },
          {
            element: <RequireRole roles={["trainer"]} />,
            children: [
              { path: "/trainer", element: <TrainerDashboardPage /> },
              { path: "/trainer/feed", element: <TrainerFeedPage /> },
              { path: "/trainer/review", element: <TrainerReviewPage /> },
              { path: "/trainer/starts", element: <TrainerStartsPage /> },
              { path: "/trainer/athletes/:id", element: <TrainerAthletePage /> },
              { path: "/trainer/runs", element: <TrainerRunsPage /> },
              { path: "/trainer/profile", element: <TrainerProfilePage /> },
              { path: "/trainer/workouts/:id", element: <WorkoutPage mode="trainer" /> }
            ]
          },
          {
            element: <RequireRole roles={["athlete"]} />,
            children: [
              { path: "/athlete", element: <AthleteDashboardPage /> },
              { path: "/athlete/runs", element: <AthleteRunsPage /> },
              { path: "/athlete/starts", element: <AthleteStartsPage /> },
              { path: "/athlete/feed", element: <TrainerFeedPage viewer="athlete" /> },
              { path: "/athlete/athletes/:id", element: <AthleteProfilePage /> },
              { path: "/athlete/athletes/:id/runs", element: <AthleteProfileRunsPage /> },
              { path: "/athlete/profile", element: <MyProfilePage /> },
              { path: "/athlete/workouts/:id", element: <WorkoutPage mode="athlete" /> }
            ]
          },
          { path: "*", element: <Navigate to="/" replace /> }
        ]
      }
    ]
  }
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  </React.StrictMode>
);

// после первого экрана — догружаем остальные страницы и включаем отклик на нажатие
preloadPages();
installPressFeedback();
