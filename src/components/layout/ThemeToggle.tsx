import { Moon, Sun, Monitor, Terminal, Waves, Flower2, Sparkles, TreePine } from "lucide-react";
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
    if (theme === "aqua") {
      return <Waves className="h-5 w-5 text-[hsl(187_80%_45%)]" />;
    }
    if (theme === "pastel-girly") {
      return <Flower2 className="h-5 w-5 text-[hsl(330_45%_68%)]" />;
    }
    if (theme === "deep-space") {
      return <Sparkles className="h-5 w-5 text-[hsl(210_100%_65%)]" />;
    }
    if (theme === "rustic-wood") {
      return <TreePine className="h-5 w-5 text-[hsl(38_55%_48%)]" />;
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
          onClick={() => setTheme("pastel-girly")}
          className={theme === "pastel-girly" ? "bg-accent" : ""}
        >
          <Flower2 className="mr-2 h-4 w-4" />
          <span>Pastel 🌸</span>
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={() => setTheme("aqua")}
          className={theme === "aqua" ? "bg-accent" : ""}
        >
          <Waves className="mr-2 h-4 w-4" />
          <span>Aqua Horizon</span>
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={() => setTheme("deep-space")}
          className={theme === "deep-space" ? "bg-accent" : ""}
        >
          <Sparkles className="mr-2 h-4 w-4" />
          <span>Deep Space 🌌</span>
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={() => setTheme("rustic-wood")}
          className={theme === "rustic-wood" ? "bg-accent" : ""}
        >
          <TreePine className="mr-2 h-4 w-4" />
          <span>Rústico 🪵</span>
        </DropdownMenuItem>
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
