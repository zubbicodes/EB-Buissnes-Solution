import React from "react";
import { HelpCircle } from "lucide-react";

export function PageHeader({ eyebrow, title, description, action, showHelp = false }) {
  return (
    <div className="eb-page-header">
      <div>
        {eyebrow && <div className="eb-eyebrow">{eyebrow}</div>}
        <h1 className="eb-title">{title}</h1>
        {description && <p className="eb-description">{description}</p>}
      </div>
      <div className="eb-page-actions">
        {action}
        {showHelp && (
          <button type="button" className="eb-help-button" data-testid="help-button">
            <HelpCircle className="h-[18px] w-[18px]" />
            <span>Need help?</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function StatCard({ icon: Icon, label, value, helper, tone = "slate", testid }) {
  return (
    <div className={`eb-stat-card eb-stat-${tone}`} data-testid={testid}>
      <div className="eb-stat-icon">{Icon && <Icon className="h-[30px] w-[30px]" />}</div>
      <div className="eb-stat-copy">
        <div className="eb-stat-label">{label}</div>
        <div className="eb-stat-value">{value}</div>
        {helper && <div className="eb-stat-helper">{helper}</div>}
      </div>
      <div className="eb-stat-spark" aria-hidden="true" />
    </div>
  );
}

export function EmptyState({ children, testid = "empty-state" }) {
  return (
    <div className="eb-empty-state" data-testid={testid}>
      {children}
    </div>
  );
}

export function BrandMark({ compact = false }) {
  return (
    <div className={`eb-brand-mark ${compact ? "eb-brand-mark-compact" : ""}`} aria-label="EB Business Solutions">
      <div className="eb-brand-symbol" aria-hidden="true">
        <span className="eb-logo-grid" />
        <span className="eb-logo-bars">
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>
      {!compact && (
        <div>
          <div className="eb-brand-name">EB Business</div>
          <div className="eb-brand-limited">Solutions Limited</div>
          <div className="eb-brand-sub">Automate. Optimise. Accelerate.</div>
        </div>
      )}
    </div>
  );
}
