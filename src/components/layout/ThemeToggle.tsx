import { Moon, Sun, Monitor, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  // Determine which icon to show based on current theme
  const getIcon = () => {
    if (theme === "matrix") {
      return <Terminal className="h-5 w-5 text-[hsl(120_100%_50%)]" />;
    }
    return (
      <>
        <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      </>
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          {getIcon()}
          <span className="sr-only">Cambiar tema</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover border-border">
        <DropdownMenuItem 
          onClick={() => setTheme("light")}
          className={theme === "light" ? "bg-accent" : ""}
        >
          <Sun className="mr-2 h-4 w-4" />
          Claro
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={() => setTheme("dark")}
          className={theme === "dark" ? "bg-accent" : ""}
        >
          <Moon className="mr-2 h-4 w-4" />
          Oscuro
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem 
          onClick={() => setTheme("matrix")}
          className={theme === "matrix" ? "bg-accent" : ""}
        >
          <Terminal className="mr-2 h-4 w-4" />
          <span className="font-mono">Retro Matrix</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem 
          onClick={() => setTheme("system")}
          className={theme === "system" ? "bg-accent" : ""}
        >
          <Monitor className="mr-2 h-4 w-4" />
          Sistema
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
