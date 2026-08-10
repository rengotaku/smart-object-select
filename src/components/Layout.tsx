import { NavLink, Outlet } from "react-router-dom";

import { cn } from "@/lib/utils";

const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
  cn(
    "text-sm font-medium text-primary-foreground/80 transition-colors hover:text-primary-foreground",
    isActive && "text-primary-foreground underline underline-offset-4"
  );

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="bg-primary text-primary-foreground shadow">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
          <span className="text-lg font-semibold">Smart Object Select</span>
          <nav className="flex items-center gap-4">
            <NavLink to="/segment" className={navLinkClassName}>
              Segment
            </NavLink>
            <NavLink to="/model-lab" className={navLinkClassName}>
              Model Lab
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
