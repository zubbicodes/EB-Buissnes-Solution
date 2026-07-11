import React from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import Landing from "@/pages/Landing";
import SignIn from "@/pages/SignIn";
import SignUp from "@/pages/SignUp";
import AppShell from "@/components/AppShell";
import Dashboard from "@/pages/Dashboard";
import NewAllocation from "@/pages/NewAllocation";
import AllocationDetail from "@/pages/AllocationDetail";
import Compare from "@/pages/Compare";
import Debtors from "@/pages/Debtors";
import Audit from "@/pages/Audit";
import Exceptions from "@/pages/Exceptions";
import Users from "@/pages/Users";

function Protected() {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500" data-testid="loading-screen">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/signin" replace />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function PublicOnly({ children }) {
  const { user } = useAuth();
  if (user === null) return null;
  if (user) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PublicOnly><Landing /></PublicOnly>} />
          <Route path="/signin" element={<PublicOnly><SignIn /></PublicOnly>} />
          <Route path="/signup" element={<PublicOnly><SignUp /></PublicOnly>} />
          <Route element={<Protected />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/new" element={<NewAllocation />} />
            <Route path="/allocations/new" element={<NewAllocation />} />
            <Route path="/allocations/:id" element={<AllocationDetail />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/debtors" element={<Debtors />} />
            <Route path="/exceptions" element={<Exceptions />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/users" element={<Users />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster position="top-right" richColors />
      </BrowserRouter>
    </AuthProvider>
  );
}
