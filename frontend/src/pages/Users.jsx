import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { toast } from "sonner";
import { ShieldCheck, Users as UsersIcon } from "lucide-react";
import { EmptyState, PageHeader, StatCard } from "@/components/DesignSystem";

const ROLES = [
  ["admin", "Admin"],
  ["user", "User"],
  ["read_only", "Read-only"],
];

export default function Users() {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get("/workspace/users");
      setData(data);
    } catch (e) {
      toast.error(formatError(e));
    }
  };

  useEffect(() => { load(); }, []);

  const updateRole = async (user, role) => {
    setSaving(user.id);
    try {
      await api.patch(`/workspace/users/${user.id}`, { role });
      toast.success("Role updated");
      await load();
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setSaving("");
    }
  };

  const users = data?.users || [];
  const admins = users.filter((u) => u.role === "admin").length;

  return (
    <div data-testid="users-page">
      <PageHeader
        eyebrow="Admin"
        title="User Management"
        description={`Workspace: ${data?.organization?.name || "Loading..."}`}
      />

      <div className="eb-stat-grid mb-5">
        <StatCard icon={UsersIcon} label="users" value={users.length} helper="Workspace members" testid="stat-users" />
        <StatCard icon={ShieldCheck} label="admins" value={admins} helper="Can manage access" testid="stat-admins" />
      </div>

      {users.length === 0 ? (
        <EmptyState testid="users-empty">No users found.</EmptyState>
      ) : (
        <>
          <div className="eb-table-wrap hidden md:block" data-testid="users-table">
            <table className="eb-table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Provider</th><th>Created</th></tr></thead>
              <tbody>{users.map((u) => (
                <tr key={u.id}>
                  <td className="font-semibold">{u.name || "-"}</td>
                  <td>{u.email}</td>
                  <td><RoleSelect user={u} saving={saving === u.id} onChange={updateRole} /></td>
                  <td>{u.auth_provider || "password"}</td>
                  <td>{u.created_at ? new Date(u.created_at).toLocaleDateString("en-GB") : "-"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">
            {users.map((u) => (
              <div key={u.id} className="eb-mobile-card">
                <div className="font-semibold">{u.name || u.email}</div>
                <div className="mt-1 text-sm text-[#0F172A]/60">{u.email}</div>
                <div className="mt-3"><RoleSelect user={u} saving={saving === u.id} onChange={updateRole} /></div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RoleSelect({ user, saving, onChange }) {
  return (
    <select
      className="eb-input !h-10 !text-sm min-w-[150px]"
      value={user.role || "user"}
      disabled={saving}
      onChange={(e) => onChange(user, e.target.value)}
    >
      {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  );
}
