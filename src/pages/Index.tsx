import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import logo from "@/assets/andromeda-logo.png";
import { Scale, ShieldCheck, Zap, BarChart3, ArrowRight, Star } from "lucide-react";

const features = [
  {
    icon: Scale,
    title: "Gestión de Procesos",
    desc: "Monitoreo automatizado de actuaciones judiciales en tiempo real.",
  },
  {
    icon: ShieldCheck,
    title: "Alertas Inteligentes",
    desc: "Notificaciones proactivas sobre vencimientos y novedades críticas.",
  },
  {
    icon: Zap,
    title: "Andro IA",
    desc: "Asistente de inteligencia artificial integrado para análisis legal.",
  },
  {
    icon: BarChart3,
    title: "Reportes & Analytics",
    desc: "Dashboards con métricas clave y visión panorámica de su portafolio.",
  },
];

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#070b1a] text-white overflow-hidden relative">
      {/* Starfield background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full bg-[#1a3a6a]/20 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full bg-[#0ea5e9]/10 blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-[#d4a017]/5 blur-[150px]" />
        {/* Orbital ring accent */}
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#d4a017]/30 to-transparent" />
        <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#0ea5e9]/30 to-transparent" />
      </div>

      {/* Hero */}
      <section className="relative flex flex-col items-center justify-center min-h-[85vh] px-4 pt-12">
        <div className="relative mb-6">
          <img
            src={logo}
            alt="Andromeda – Su Universo Legal"
            className="h-48 md:h-64 w-auto object-contain relative z-10 drop-shadow-[0_0_40px_rgba(212,160,23,0.3)]"
          />
        </div>

        <p className="text-lg md:text-xl text-[#a0b4d0] max-w-xl text-center mb-10 leading-relaxed">
          Plataforma integral de monitoreo judicial con inteligencia artificial. 
          Controle sus procesos legales desde un solo lugar.
        </p>

        <div className="flex flex-col sm:flex-row gap-4">
          <Button
            size="lg"
            onClick={() => navigate("/auth")}
            className="bg-gradient-to-r from-[#d4a017] to-[#e8b830] text-[#070b1a] font-bold px-8 py-6 text-base hover:from-[#e8b830] hover:to-[#f0c848] shadow-[0_0_30px_rgba(212,160,23,0.3)] transition-all hover:shadow-[0_0_40px_rgba(212,160,23,0.5)]"
          >
            Comenzar Ahora
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => navigate("/auth")}
            className="border-[#0ea5e9]/40 text-[#0ea5e9] hover:bg-[#0ea5e9]/10 hover:border-[#0ea5e9]/60 px-8 py-6 text-base bg-transparent"
          >
            Iniciar Sesión
          </Button>
        </div>

        {/* Trust badge */}
        <div className="mt-12 flex items-center gap-2 text-[#a0b4d0]/60 text-sm">
          <Star className="h-4 w-4 text-[#d4a017]" />
          <span>Plataforma en fase Beta · Acceso exclusivo para firmas seleccionadas</span>
        </div>
      </section>

      {/* Features */}
      <section className="relative px-4 pb-24 pt-8">
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-[#1a3a6a]/40 bg-[#0c1528]/60 backdrop-blur-sm p-6 hover:border-[#d4a017]/40 transition-colors group"
            >
              <div className="h-10 w-10 rounded-lg bg-[#0ea5e9]/10 flex items-center justify-center mb-4 group-hover:bg-[#d4a017]/10 transition-colors">
                <f.icon className="h-5 w-5 text-[#0ea5e9] group-hover:text-[#d4a017] transition-colors" />
              </div>
              <h3 className="font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-sm text-[#a0b4d0]/80 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-[#1a3a6a]/30 py-8 px-4 text-center">
        <p className="text-sm text-[#a0b4d0]/50">
          © {new Date().getFullYear()} Andromeda · Su Universo Legal
        </p>
      </footer>
    </div>
  );
};

export default Index;
