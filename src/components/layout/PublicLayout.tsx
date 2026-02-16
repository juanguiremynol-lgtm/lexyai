import { Link, Outlet } from "react-router-dom";
import { Button } from "@/components/ui/button";
import andromedaLogo from "@/assets/andromeda-logo.png";

/**
 * PublicLayout - Layout wrapper for unauthenticated public pages
 * Uses the landing page's cosmic dark theme (navy/gold/cyan)
 */
export function PublicLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-[#070b1a] text-white">
      {/* Public header */}
      <header className="border-b border-[#1a3a6a]/30 bg-[#070b1a]/90 backdrop-blur-sm sticky top-0 z-50">
        <div className="container max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={andromedaLogo} alt="Andromeda" className="h-10" />
            <span className="font-bold text-lg hidden sm:inline text-white">Andromeda</span>
          </Link>
          
          <nav className="hidden md:flex items-center gap-6">
            <a href="/#features" className="text-sm text-[#a0b4d0] hover:text-white transition-colors">
              Funcionalidades
            </a>
            <a href="/#andro-ia" className="text-sm text-[#a0b4d0] hover:text-white transition-colors">
              Andro IA
            </a>
            <Link to="/pricing" className="text-sm text-[#a0b4d0] hover:text-white transition-colors">
              Precios
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <Button variant="ghost" asChild className="text-[#a0b4d0] hover:text-white hover:bg-[#1a3a6a]/30">
              <Link to="/auth">Iniciar sesión</Link>
            </Button>
            <Button asChild className="bg-gradient-to-r from-[#d4a017] to-[#e8b830] text-[#070b1a] font-bold hover:from-[#e8b830] hover:to-[#f0c848]">
              <Link to="/auth?signup=true">Comenzar gratis</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1a3a6a]/30 bg-[#050a16] py-8">
        <div className="container max-w-7xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <img src={andromedaLogo} alt="Andromeda" className="h-8 opacity-70" />
              <span className="text-sm text-[#a0b4d0]/60">
                © {new Date().getFullYear()} Andromeda. Todos los derechos reservados.
              </span>
            </div>
            <div className="flex items-center gap-4 text-sm text-[#a0b4d0]/60">
              <a href="mailto:soporte@andromeda.legal" className="hover:text-white transition-colors">
                Soporte
              </a>
              <Link to="/pricing" className="hover:text-white transition-colors">
                Precios
              </Link>
              <Link to="/legal/terms" className="hover:text-white transition-colors">
                Términos y Condiciones
              </Link>
              <Link to="/legal/privacy" className="hover:text-white transition-colors">
                Privacidad
              </Link>
              <a href="/#andro-ia" className="hover:text-white transition-colors">
                Andro IA
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
