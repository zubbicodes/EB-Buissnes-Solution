import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import {
  LayoutDashboard, GitCompareArrows, Users, ScrollText,
  LogOut, PlusCircle, Search, AlertTriangle, ShieldCheck,
} from "lucide-react";
import { BrandMark } from "@/components/DesignSystem";
import topbarMoon from "@/assets/moon.png";
import topbarBell from "@/assets/bell.png";
import topbarAvatar from "@/assets/profile.png";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/new", label: "New Allocation", icon: PlusCircle, testid: "nav-new" },
  { to: "/compare", label: "Compare", icon: GitCompareArrows, testid: "nav-compare" },
  { to: "/debtors", label: "Debtor Report", icon: Users, testid: "nav-debtors" },
  { to: "/exceptions", label: "Exceptions", icon: AlertTriangle, testid: "nav-exceptions" },
  { to: "/audit", label: "Audit Trail", icon: ScrollText, testid: "nav-audit" },
  { to: "/users", label: "Users", icon: ShieldCheck, testid: "nav-users", adminOnly: true },
];

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [notificationCount, setNotificationCount] = useState(0);
  const hideTopbar = location.pathname === "/new" || location.pathname.startsWith("/allocations/") || location.pathname === "/debtors" || location.pathname === "/audit" || location.pathname === "/compare" || location.pathname === "/exceptions" || location.pathname === "/users";
  const compactLayout = location.pathname === "/new" || location.pathname.startsWith("/allocations/");
  const visibleNav = navItems.filter((item) => !item.adminOnly || user?.role === "admin");
  const initials = (user?.name || user?.email || "JD")
    .split(/[ @.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "JD";

  const signOut = async () => {
    await logout();
    navigate("/");
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setSearchTerm(params.get("q") || "");
  }, [location.search]);

  useEffect(() => {
    if (!user) {
      setNotificationCount(0);
      return;
    }

    let active = true;
    api.get("/allocations")
      .then(({ data }) => {
        if (!active) return;
        const count = (data || []).filter((run) => {
          const stats = run.stats || {};
          return (stats.partially_matched || 0) > 0 || (stats.unmatched_bank || 0) > 0;
        }).length;
        setNotificationCount(count);
      })
      .catch(() => {
        if (active) setNotificationCount(0);
      });

    return () => { active = false; };
  }, [user, location.pathname]);

  const submitSearch = (event) => {
    event.preventDefault();
    const q = searchTerm.trim();
    const lowered = q.toLowerCase();
    if (lowered === "new" || lowered.includes("allocation")) {
      navigate("/new");
      return;
    }
    if (lowered.includes("compare")) {
      navigate("/compare");
      return;
    }
    if (lowered.includes("debtor")) {
      navigate("/debtors");
      return;
    }
    if (lowered.includes("audit")) {
      navigate("/audit");
      return;
    }
    if (lowered.includes("exception")) {
      navigate("/exceptions");
      return;
    }
    if (lowered.includes("user") || lowered.includes("admin")) {
      navigate("/users");
      return;
    }
    navigate(q ? `/dashboard?q=${encodeURIComponent(q)}` : "/dashboard");
  };

  return (
    <div className="eb-shell">
      <aside className="eb-sidebar">
        <Link to="/dashboard" className="px-[50px] pt-[25px]" data-testid="brand-link">
          <BrandMark />
        </Link>
        <div className="mt-[25px] h-px bg-white/15" />

        <nav className="eb-nav">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              data-testid={item.testid}
              className={({ isActive }) =>
                `eb-nav-link ${isActive ? "eb-nav-link-active" : ""}`
              }
            >
              <item.icon />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="relative z-10 mt-auto p-[30px]">
          <div className="flex h-[74px] items-center gap-[14px] rounded-[12px] bg-white px-4 text-[#0F172A] shadow-sm">
            <div className="eb-profile-avatar">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[16px] font-medium" data-testid="user-name">{user?.name || "John Doe"}</div>
              <div className="mt-1 truncate text-[13px] text-[#0F172A]/60">{user?.role === "read_only" ? "Read-only" : user?.role === "user" ? "Standard User" : "Administrator"}</div>
            </div>
            <button
              onClick={signOut}
              className="rounded-md p-2 text-[#0F172A]/70 hover:bg-[#0F172A]/5 hover:text-[#0F172A]"
              data-testid="sign-out-button"
              title="Sign out"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </aside>

      <main className="eb-main">
        <div className="lg:hidden border-b border-[#0F172A]/5 bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <Link to="/dashboard"><BrandMark compact /></Link>
            <button onClick={signOut} className="eb-button-secondary !h-10 !px-3 !text-sm" data-testid="sign-out-button-mobile">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
          <nav className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {visibleNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `inline-flex shrink-0 items-center gap-2 rounded-[8px] px-3 py-2 text-sm font-medium ${
                    isActive ? "bg-[#0F172A] text-white" : "bg-[#F8FAFB] text-[#0F172A]/70"
                  }`
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className={`eb-main-inner ${compactLayout ? "eb-main-inner-compact" : ""}`}>
          {!hideTopbar && (
            <div className="eb-topbar">
              <h2 className="eb-welcome-title">Welcome!</h2>
              <form className="eb-search" onSubmit={submitSearch} role="search">
                <Search className="h-[18px] w-[18px]" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search..."
                  className="min-w-0 flex-1 bg-transparent text-[14px] text-[#0F172A] outline-none placeholder:text-[#0F172A]/55"
                  data-testid="topbar-search"
                />
              </form>
              <div className="eb-topbar-actions">
                <button className="hidden h-[25px] w-[25px] items-center justify-center md:flex" title="Theme">
                  <img src={topbarMoon} alt="" className="h-[25px] w-[25px]" />
                </button>
                <button className="relative hidden h-[25px] w-[25px] items-center justify-center md:flex" title="Notifications">
                  <img src={topbarBell} alt="" className="h-[25px] w-[25px]" />
                  {notificationCount > 0 && (
                    <span className="eb-notification-badge" aria-label={`${notificationCount} notifications`}>
                      {notificationCount > 99 ? "99+" : notificationCount}
                    </span>
                  )}
                </button>
                <img src={topbarAvatar} alt="" className="eb-user-avatar" />
              </div>
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
