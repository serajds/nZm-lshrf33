import type { CSSProperties } from "react";
import { Link, useLocation } from "wouter";

const navItems = [
  { label: "ملخص المشروع", path: "" },
  { label: "الجدول الزمني", path: "/activities" },
  { label: "التمديدات", path: "/extensions" },
  { label: "التقارير", path: "/reports" },
  { label: "الملفات", path: "/files" },
  { label: "تحليل الانحراف", path: "/deviation" },
];

interface ProjectNavProps {
  projectId: number;
}

export function ProjectNav({ projectId }: ProjectNavProps) {
  const [location] = useLocation();
  const basePath = `/projects/${projectId}`;

  return (
    <div
      className="overflow-x-auto -mx-4 md:-mx-6"
      style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" } as CSSProperties}
    >
      <div
        className="flex border-b border-border px-4 md:px-6"
        style={{ minWidth: "max-content" }}
      >
        {navItems.map((item) => {
          const href = `${basePath}${item.path}`;
          const isActive =
            item.path === ""
              ? location === href
              : location.startsWith(href);

          return (
            <Link key={item.path} href={href}>
              <span
                className={`inline-flex items-center px-4 py-3 text-sm font-medium whitespace-nowrap cursor-pointer border-b-2 transition-colors ${
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                style={{ marginBottom: "-1px" }}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
