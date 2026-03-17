import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";

import { AppLayout } from "./components/AppLayout";
import { RequireAuth } from "./components/RequireAuth";
import { AuthProvider } from "./components/AuthProvider";
import { LoginPage } from "./pages/LoginPage";
import { AdminPage } from "./pages/AdminPage";
import { TrainerDashboardPage } from "./pages/TrainerDashboardPage";
import { TrainerAthletePage } from "./pages/TrainerAthletePage";
import { WorkoutPage } from "./pages/WorkoutPage";
import { AthleteDashboardPage } from "./pages/AthleteDashboardPage";
import "./styles.css";

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
          { path: "/admin", element: <AdminPage /> },
          { path: "/trainer", element: <TrainerDashboardPage /> },
          { path: "/trainer/athletes/:id", element: <TrainerAthletePage /> },
          { path: "/trainer/workouts/:id", element: <WorkoutPage mode="trainer" /> },
          { path: "/athlete", element: <AthleteDashboardPage /> },
          { path: "/athlete/workouts/:id", element: <WorkoutPage mode="athlete" /> },
          { path: "*", element: <Navigate to="/" replace /> }
        ]
      }
    ]
  }
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </React.StrictMode>
);
