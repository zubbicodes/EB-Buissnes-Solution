import React, { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import {
  LayoutDashboard, GitCompareArrows, Users, ScrollText,
  LogOut, PlusCircle, Search, AlertTriangle, ShieldCheck,
  CheckCircle2, XCircle, Clock3, FileCheck2,
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
  const [notifications, setNotifications] = useState([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const notificationRef = useRef(null);
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

  const notificationKey = `ebrr_notifications_seen_${user?.id || "anonymous"}`;

  const loadNotifications = async () => {
    if (!user) return;
    setNotificationLoading(true);
    try {
      const [{ data: runs }, { data: audit }] = await Promise.all([
        api.get("/allocations"),
        api.get("/audit"),
      ]);
      const runById = Object.fromEntries((runs || []).map((run) => [run.id, run]));
      const actionContent = {
        validate_upload: ["Validation completed", FileCheck2, "/new"],
        create_run_queued: ["Allocation queued", Clock3, null],
        create_run: ["Allocation completed", CheckCircle2, null],
        create_run_failed: ["Allocation failed", XCircle, null],
        create_run_interrupted: ["Allocation interrupted", AlertTriangle, null],
        delete_run: ["Allocation deleted", XCircle, "/audit"],
        archive_run: ["Allocation archived", XCircle, "/audit"],
        manual_link: ["Manual allocation saved", CheckCircle2, null],
        manual_unlink: ["Manual allocation removed", AlertTriangle, null],
        user_role_update: ["User role updated", ShieldCheck, "/users"],
      };
      const items = (audit?.logs || []).map((event) => {
        const [title, Icon, defaultTarget] = actionContent[event.action] || ["Activity recorded", Clock3, "/audit"];
        const run = event.run_id ? runById[event.run_id] : null;
        const details = event.details || {};
        let message = details.name || run?.name || event.action.replaceAll("_", " ");
        if (event.action === "validate_upload") {
          message = `${details.bank_rows || 0} bank rows and ${details.invoice_rows || 0} invoice rows checked`;
        } else if (event.action === "create_run") {
          message = `${run?.name || "Run"} finished with ${details.stats?.fully_matched || 0} confirmed matches`;
        } else if (event.action === "create_run_queued") {
          message = `${details.name || run?.name || "Run"} is ready for processing`;
        }
        return {
          id: event.id,
          title,
          message,
          createdAt: event.created_at,
          target: event.run_id && event.action !== "delete_run" && event.action !== "archive_run"
            ? `/allocations/${event.run_id}`
            : defaultTarget || "/audit",
          Icon,
          tone: event.action.includes("failed") || event.action.includes("interrupted") ? "rose" : "emerald",
        };
      });
      (runs || []).filter((run) => run.status === "processing").forEach((run) => {
        items.push({
          id: `processing-${run.id}`,
          title: run.progress_phase || "Allocation processing",
          message: `${run.name}: ${Math.round(run.progress || 5)}% complete`,
          createdAt: run.created_at,
          target: `/allocations/${run.id}`,
          Icon: Clock3,
          tone: "blue",
        });
      });
      items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const next = items.slice(0, 20);
      setNotifications(next);
      const seenAt = localStorage.getItem(notificationKey) || "";
      setNotificationCount(next.filter((item) => !seenAt || new Date(item.createdAt) > new Date(seenAt)).length);
    } catch {
      setNotifications([]);
      setNotificationCount(0);
    } finally {
      setNotificationLoading(false);
    }
  };

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setNotificationCount(0);
      return undefined;
    }
    loadNotifications();
    const timer = setInterval(loadNotifications, 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, location.pathname]);

  useEffect(() => {
    const close = (event) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target)) setNotificationOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const toggleNotifications = () => {
    const nextOpen = !notificationOpen;
    setNotificationOpen(nextOpen);
    if (nextOpen) {
      localStorage.setItem(notificationKey, new Date().toISOString());
      setNotificationCount(0);
      loadNotifications();
    }
  };

  const openNotification = (item) => {
    setNotificationOpen(false);
    navigate(item.target);
  };

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
                <div className="relative hidden md:block" ref={notificationRef}>
                  <button
                    onClick={toggleNotifications}
                    className="relative flex h-[25px] w-[25px] items-center justify-center"
                    title="Notifications"
                    aria-label="Notifications"
                    aria-haspopup="dialog"
                    aria-expanded={notificationOpen}
                    data-testid="notifications-button"
                  >
                    <img src={topbarBell} alt="" className="h-[25px] w-[25px]" />
                    {notificationCount > 0 && (
                      <span className="eb-notification-badge" aria-label={`${notificationCount} unread notifications`}>
                        {notificationCount > 99 ? "99+" : notificationCount}
                      </span>
                    )}
                  </button>
                  {notificationOpen && (
                    <div
                      className="absolute right-0 top-10 z-50 w-[380px] overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-2xl"
                      role="dialog"
                      aria-label="Notifications"
                      data-testid="notifications-panel"
                    >
                      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                        <div>
                          <div className="font-display text-base font-semibold text-slate-950">Notifications</div>
                          <div className="mt-0.5 text-xs text-slate-500">Validation and allocation activity</div>
                        </div>
                        <button onClick={() => navigate("/audit")} className="text-xs font-semibold text-emerald-700 hover:underline">
                          View audit
                        </button>
                      </div>
                      <div className="max-h-[420px] overflow-y-auto">
                        {notificationLoading && notifications.length === 0 && (
                          <div className="px-4 py-8 text-center text-sm text-slate-500">Loading notifications...</div>
                        )}
                        {!notificationLoading && notifications.length === 0 && (
                          <div className="px-4 py-8 text-center text-sm text-slate-500">No notifications yet.</div>
                        )}
                        {notifications.map((item) => {
                          const Icon = item.Icon;
                          const iconTone = item.tone === "rose"
                            ? "bg-rose-100 text-rose-700"
                            : item.tone === "blue"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-emerald-100 text-emerald-700";
                          return (
                            <button
                              key={item.id}
                              onClick={() => openNotification(item)}
                              className="flex w-full gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50"
                              data-testid={`notification-${item.id}`}
                            >
                              <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconTone}`}>
                                <Icon className="h-4 w-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-slate-900">{item.title}</span>
                                <span className="mt-0.5 block truncate text-xs text-slate-600">{item.message}</span>
                                <span className="mt-1 block text-[11px] text-slate-400">{new Date(item.createdAt).toLocaleString("en-GB")}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
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
