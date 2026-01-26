import { Link, Outlet } from "react-router-dom";
import { Button } from "@/components/ui/button";
import ateniaLogo from "@/assets/atenia-logo.png";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

/**
 * PublicLayout - Layout wrapper for unauthenticated public pages
 * No sidebar, minimal header with login/signup CTAs
 */
export function PublicLayout() {
  const { theme } = useTheme();
  const isAquaTheme = theme === "aqua";

  return (
    <div className={cn(
      "min-h-screen flex flex-col",
      isAquaTheme ? "bg-transparent" : "bg-background"
    )}>
      {/* Simple public header */}
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={ateniaLogo} alt="ATENIA" className="h-10" />
          </Link>
          
          <div className="flex items-center gap-3">
            <Button variant="ghost" asChild>
              <Link to="/auth">Iniciar sesión</Link>
            </Button>
            <Button asChild>
              <Link to="/auth?signup=true">Crear cuenta</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Simple footer */}
      <footer className="border-t bg-muted/30 py-8">
        <div className="container max-w-7xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <img src={ateniaLogo} alt="ATENIA" className="h-8 opacity-70" />
              <span className="text-sm text-muted-foreground">
                © {new Date().getFullYear()} ATENIA. Todos los derechos reservados.
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <a href="mailto:soporte@atenia.co" className="hover:text-foreground transition-colors">
                Soporte
              </a>
              <Link to="/pricing" className="hover:text-foreground transition-colors">
                Precios
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
