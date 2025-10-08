import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { useActivityLog } from "./hooks/useActivityLog";

type NavItem = {
  label: string;
  to: string;
  icon?: ReactNode;
};

type SideNavProps = {
  items: NavItem[];
};

export function SideNav({ items }: SideNavProps) {
  const { entries, isOpen, toggleOpen } = useActivityLog();

  const errorCount = useMemo(() => entries.filter((entry) => entry.status === "error").length, [entries]);

  return (
    <aside className="side-nav">
      <nav aria-label="Primary" className="side-nav__primary">
        <ul>
          {items.map((item) => (
            <li key={item.label}>
              <NavLink
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `side-nav__link${isActive ? " side-nav__link--active" : ""}`
                }
              >
                {item.icon && (
                  <span className="side-nav__icon" aria-hidden="true">
                    {item.icon}
                  </span>
                )}
                <span className="side-nav__label">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="side-nav__footer">
        <button
          type="button"
          className={`side-nav__toggle${isOpen ? " side-nav__toggle--active" : ""}`}
          onClick={() => toggleOpen()}
          aria-pressed={isOpen}
        >
          <span className="side-nav__icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22a4 4 0 0 0 4-4H8a4 4 0 0 0 4 4Z" />
              <path d="M18 13V10a6 6 0 0 0-12 0v3l-2 3h16Z" />
            </svg>
          </span>
          <span className="side-nav__label">Activity log</span>
          {errorCount > 0 && <span className="side-nav__badge" aria-label={`${errorCount} failed actions`}>{errorCount}</span>}
        </button>
      </div>
    </aside>
  );
}
