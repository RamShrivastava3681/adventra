import { Eye, EyeOff } from "lucide-react";

/**
 * Full-width banner shown while a reporting manager is viewing an assigned
 * employee's workspace (view-as mode). Lets them know they're browsing the
 * employee's tabs and data in read-only mode, and provides a way to exit.
 */
export function ViewAsBanner({ userName, onExit }: { userName: string; onExit: () => void }) {
  return (
    <div className="z-50 flex items-center justify-between gap-3 border-b border-primary/20 bg-primary/10 px-6 py-3 backdrop-blur-sm md:sticky md:top-0">
      <div className="flex min-w-0 items-center gap-2">
        <Eye className="h-4 w-4 shrink-0 text-primary" />
        <span className="truncate text-xs font-medium text-primary">
          Viewing as <strong>{userName}</strong> — read-only
        </span>
      </div>
      <button
        onClick={onExit}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-all hover:bg-primary/20"
      >
        <EyeOff className="h-3.5 w-3.5" />
        Exit view-as
      </button>
    </div>
  );
}
