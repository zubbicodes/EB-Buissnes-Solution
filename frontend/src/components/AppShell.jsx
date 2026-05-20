import React from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  LayoutDashboard, FileSpreadsheet, GitCompareArrows, Users, ScrollText,
  LogOut, PlusCircle, Building2,
} from "lucide-react";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/new", label: "New Allocation", icon: PlusCircle, testid: "nav-new" },
  { to: "/compare", label: "Compare", icon: GitCompareArrows, testid: "nav-compare" },
  { to: "/debtors", label: "Debtor Report", icon: Users, testid: "nav-debtors" },
  { to: "/audit", label: "Audit Trail", icon: ScrollText, testid: "nav-audit" },
];

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex bg-[#F8FAFC]">
      <aside className="w-64 shrink-0 bg-[#0F172A] text-slate-100 flex flex-col border-r border-slate-900">
        <Link to="/dashboard" className="px-6 py-5 flex items-center gap-3 border-b border-slate-800" data-testid="brand-link">
          <div className="h-9 w-9 rounded-md bg-gradient-to-br from-emerald-500 to-blue-600 flex items-center justify-center">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="font-display font-bold leading-tight text-sm">Receivables<br/>Reconciliation</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mt-1">EB Business Solutions</div>
          </div>
        </Link>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              data-testid={item.testid}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                    : "text-slate-300 hover:bg-slate-800/60 hover:text-white"
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-slate-800">
          <div className="text-xs text-slate-400 uppercase tracking-wider">Signed in</div>
          <div className="text-sm font-medium mt-1 truncate" data-testid="user-name">{user?.name || user?.email}</div>
          <div className="text-xs text-slate-500 truncate">{user?.email}</div>
          <button
            onClick={async () => { await logout(); navigate("/"); }}
            data-testid="sign-out-button"
            className="mt-3 w-full flex items-center justify-center gap-2 text-xs bg-slate-800 hover:bg-slate-700 text-slate-100 py-2 rounded-md transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-x-hidden">
        <div className="max-w-[1400px] mx-auto px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
